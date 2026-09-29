// One drag helper for the board and the calendar, on pointer events, so mouse,
// pen and touch share it. Touch starts after a short long-press so a swipe
// still scrolls; the dragged item follows the pointer with a transform inside
// requestAnimationFrame (no layout reads per move); the scroller auto-scrolls
// near its edges; Esc cancels. The maths is pure and exported for tests.

/** A touch must rest this long before it picks an item up. */
export const LONG_PRESS_MS = 180;
/** A touch that moves further than this first is a scroll, not a drag. */
export const TOUCH_SLOP = 8;
/** A mouse or pen drag starts once the pointer moved this far. */
export const MOUSE_SLOP = 4;
/** Auto-scroll zone at each edge, and the top speed in px per frame. */
export const EDGE_ZONE = 48;
export const EDGE_SPEED = 18;

const INTERACTIVE = 'button, select, input, textarea, a, label, [contenteditable="true"]';

export const distance = (dx, dy) => Math.hypot(dx, dy);

/** Round minutes to the nearest step (15 by default). */
export function snapMinutes(minutes, step = 15) {
  return Math.round(minutes / step) * step;
}

/**
 * What a press that has not picked anything up yet becomes after moving
 * `moved` px: 'drag' (mouse and pen past the slop), 'scroll' (a touch that
 * moved before the long-press ended), or 'wait'.
 */
export function pressDecision(pointerType, moved) {
  if (pointerType === 'touch') return moved > TOUCH_SLOP ? 'scroll' : 'wait';
  return moved > MOUSE_SLOP ? 'drag' : 'wait';
}

/**
 * Auto-scroll speed for a pointer at `pos` inside [start, end]: negative near
 * the start, positive near the end, faster the closer to the edge, 0 elsewhere.
 */
export function edgeSpeed(pos, start, end, zone = EDGE_ZONE, max = EDGE_SPEED) {
  if (end - start <= zone * 2) return 0;
  if (pos < start + zone) return -Math.ceil(max * Math.min(1, (start + zone - pos) / zone));
  if (pos > end - zone) return Math.ceil(max * Math.min(1, (pos - (end - zone)) / zone));
  return 0;
}

/** Index of the first rect {left, top, right, bottom} holding the point, or -1. */
export function hitTest(rects, x, y) {
  return rects.findIndex(r => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

/** Plain copy of a DOMRect, so it can be cached and shifted. */
export const rectOf = node => {
  const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
  return { left, top, right, bottom, width, height };
};

const scrollerOf = option => option || document.scrollingElement || document.documentElement;

/**
 * Make items under `root` draggable.
 * - selector: what is picked up (closest() from the pointer's target)
 * - handle: optional selector that starts a drag even on an interactive child
 * - ignore: children that never start a drag (buttons, fields, links by default)
 * - onStart({item, handle, x, y, pointerType}) → a context object, or null to refuse
 * - onMove(ctx, {x, y, dx, dy}) each frame; dx/dy include auto-scroll
 * - onDrop(ctx, point) on release; onCancel(ctx) on Esc or pointercancel
 * The item moves by transform unless the context sets `move: false`.
 * @returns {() => void} unbind
 */
export function makeDraggable(root, { selector, handle = null, ignore = INTERACTIVE, scroller = null, onStart, onMove = () => {}, onDrop = () => {}, onCancel = () => {} }) {
  let press = null; // the pointer that is down, before or during a drag

  function reset() {
    if (!press) return;
    clearTimeout(press.timer);
    cancelAnimationFrame(press.frame);
    if (press.ctx && press.ctx.move !== false) press.item.style.transform = '';
    press.item.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging-any');
    window.removeEventListener('keydown', onKey, true);
    press = null;
  }

  function point() {
    const scroll = press.scroll;
    const sx = scroll.el.scrollLeft - scroll.left;
    const sy = scroll.el.scrollTop - scroll.top;
    return { x: press.x, y: press.y, dx: press.x - press.startX + sx, dy: press.y - press.startY + sy, sx, sy };
  }

  function frame() {
    if (!press || !press.ctx) return;
    const { el, rect } = press.scroll;
    const vx = edgeSpeed(press.x, rect.left, rect.right);
    const vy = edgeSpeed(press.y, rect.top, rect.bottom);
    if (vx) el.scrollLeft += vx;
    if (vy) el.scrollTop += vy;
    const p = point();
    if (press.ctx.move !== false) press.item.style.transform = `translate3d(${p.dx}px, ${p.dy}px, 0)`;
    onMove(press.ctx, p);
    press.frame = requestAnimationFrame(frame);
  }

  function begin() {
    const ctx = onStart({ item: press.item, handle: press.handle, x: press.startX, y: press.startY, pointerType: press.type });
    if (!ctx) {
      press = null;
      return;
    }
    press.ctx = ctx;
    const el = scrollerOf(typeof scroller === 'function' ? scroller() : scroller);
    const isPage = el === document.scrollingElement || el === document.documentElement;
    const rect = isPage ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : rectOf(el);
    press.scroll = { el, rect, left: el.scrollLeft, top: el.scrollTop };
    press.item.classList.add('is-dragging');
    document.body.classList.add('is-dragging-any');
    try { press.item.setPointerCapture(press.id); } catch { /* the pointer is gone */ }
    if (press.type === 'touch' && navigator.vibrate) navigator.vibrate(8);
    window.addEventListener('keydown', onKey, true);
    press.frame = requestAnimationFrame(frame);
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !press || !press.ctx) return;
    e.preventDefault();
    e.stopPropagation();
    const { ctx } = press;
    press.cancelled = true;
    reset();
    onCancel(ctx);
  }

  function onDown(e) {
    if (press || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = e.target.closest(selector);
    if (!item || !root.contains(item)) return;
    const grip = handle ? e.target.closest(handle) : null;
    const skip = ignore && e.target.closest(ignore);
    if (!grip && skip && item.contains(skip)) return;
    press = {
      id: e.pointerId, type: e.pointerType, item, handle: grip,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, ctx: null, timer: null, frame: 0
    };
    if (e.pointerType === 'touch') press.timer = setTimeout(begin, LONG_PRESS_MS);
    else if (grip) begin();
  }

  function onPointerMove(e) {
    if (!press || e.pointerId !== press.id) return;
    press.x = e.clientX;
    press.y = e.clientY;
    if (press.ctx) return; // the frame loop draws it
    const next = pressDecision(press.type, distance(e.clientX - press.startX, e.clientY - press.startY));
    if (next === 'scroll') reset(); // the browser scrolls or swipes instead
    else if (next === 'drag') begin();
  }

  function onUp(e) {
    if (!press || e.pointerId !== press.id) return;
    const { ctx } = press;
    if (!ctx) {
      reset();
      return;
    }
    const p = point();
    reset();
    // The release is not also a click on the item.
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    onDrop(ctx, p);
  }

  function onPointerCancel(e) {
    if (!press || e.pointerId !== press.id) return;
    const { ctx } = press;
    reset();
    if (ctx) onCancel(ctx);
  }

  // Once a touch drag has started, the page must not scroll under it.
  const onTouchMove = e => { if (press && press.ctx) e.preventDefault(); };
  // A long-press would open the phone's context menu or select text.
  const onContextMenu = e => { if (press) e.preventDefault(); };
  const swallow = e => { e.stopPropagation(); e.preventDefault(); };

  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('contextmenu', onContextMenu);

  return () => {
    reset();
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('contextmenu', onContextMenu);
  };
}
