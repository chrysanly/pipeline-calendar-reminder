// Day and Week as Google-style hour grids: 24 rows, reminders at their time,
// overlaps side by side, a "now" line, and an all-day row for reminders with no
// time. Drag a reminder to move it (Week: to another day too), drag its bottom
// edge to change its length; both snap to 15 minutes. The maths is in
// calendar.js; the pointer handling in drag.js.

import {
  weekdayNames, formatDayLabel, eventsSortedByTime, timeToMinutes, minutesToTime, minutesToPx, pxToMinutes,
  moveEventTime, resizeDuration, layoutOverlaps, HOUR_PX, DAY_MINUTES
} from './calendar.js';
import { eventDuration } from './storage.js';
import { makeDraggable, hitTest, rectOf } from './drag.js';
import { el, renderChip } from './ui.js';

/** Where Day/Week open when today is not on screen: 7am. */
const MORNING_MINUTES = 7 * 60;

// The period on screen, so a re-render keeps the scroll and a new one resets it.
let shownPeriod = '';

const nowMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

function hourLabel(hour) {
  if (hour === 0) return '';
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12} ${suffix}`;
}

function dayHead(cell, handlers) {
  const head = el('button', 'tg-day-head');
  head.type = 'button';
  head.dataset.key = cell.key;
  if (cell.isToday) head.classList.add('is-today');
  head.append(el('span', 'weekday-name', weekdayNames()[cell.date.getDay()]), el('span', 'weekday-number', String(cell.date.getDate())));
  head.addEventListener('click', () => handlers.onSelectDay(cell.key));
  return head;
}

/** A timed reminder, placed by its start, length and overlap lane. */
function timedChip(evt, place, handlers) {
  const start = timeToMinutes(evt.time);
  const duration = Math.min(eventDuration(evt), DAY_MINUTES - start);
  const chip = renderChip(evt, handlers);
  chip.classList.add('tg-event');
  if (duration < 45) chip.classList.add('is-short');
  chip.dataset.date = evt.date;
  chip.dataset.start = String(start);
  chip.dataset.duration = String(duration);
  chip.style.top = `${minutesToPx(start)}px`;
  chip.style.height = `${Math.max(minutesToPx(duration) - 2, 14)}px`;
  chip.style.left = `calc(${(place.lane / place.lanes) * 100}% + 2px)`;
  chip.style.width = `calc(${100 / place.lanes}% - 4px)`;
  const resize = el('span', 'tg-resize');
  resize.setAttribute('aria-hidden', 'true');
  resize.title = 'Drag to change the length';
  chip.appendChild(resize);
  return chip;
}

function dayColumn(cell, dayEvents, state, handlers) {
  const column = el('div', 'day tg-col');
  column.dataset.key = cell.key;
  if (cell.isToday) column.classList.add('is-today');
  if (cell.key === state.selectedKey) column.classList.add('is-selected');
  column.setAttribute('aria-label', `${formatDayLabel(cell.key)}, ${dayEvents.length} reminder(s)`);

  const timed = dayEvents.filter(evt => timeToMinutes(evt.time) !== null);
  const lanes = layoutOverlaps(timed.map(evt => {
    const start = timeToMinutes(evt.time);
    return { id: evt.id, start, end: Math.min(DAY_MINUTES, start + eventDuration(evt)) };
  }));
  for (const evt of timed) column.appendChild(timedChip(evt, lanes.get(evt.id), handlers));

  if (cell.isToday) {
    const now = el('div', 'tg-now');
    now.style.top = `${minutesToPx(nowMinutes())}px`;
    now.setAttribute('aria-hidden', 'true');
    column.appendChild(now);
  }
  column.addEventListener('click', e => {
    if (e.target === column) handlers.onSelectDay(cell.key);
  });
  return column;
}

function allDayCell(cell, dayEvents, handlers) {
  const box = el('div', 'tg-allday-cell');
  box.dataset.key = cell.key;
  for (const evt of dayEvents.filter(e => timeToMinutes(e.time) === null)) box.appendChild(renderChip(evt, handlers));
  return box;
}

function gutterHours() {
  const hours = el('div', 'tg-hours');
  hours.setAttribute('aria-hidden', 'true');
  for (let hour = 0; hour < 24; hour++) {
    const label = el('span', 'tg-hour', hourLabel(hour));
    label.style.top = `${hour * HOUR_PX}px`;
    hours.appendChild(label);
  }
  return hours;
}

/** Draw Day (one column) or Week (seven) into #grid. */
export function renderTimeGrid(grid, cells, byDate, state, handlers) {
  const oldScroll = grid.querySelector('.tg-scroll');
  const period = `${state.view}:${cells[0].key}`;
  const keepTop = oldScroll && shownPeriod === period ? oldScroll.scrollTop : null;
  shownPeriod = period;

  grid.innerHTML = '';
  grid.className = `grid view-${state.view} time-grid`;
  grid.style.setProperty('--cols', String(cells.length));

  const head = el('div', 'tg-head');
  head.appendChild(el('span', 'tg-gutter'));
  for (const cell of cells) head.appendChild(dayHead(cell, handlers));

  const allDay = el('div', 'tg-allday');
  allDay.appendChild(el('span', 'tg-gutter tg-allday-label', 'All day'));
  const perDay = cells.map(cell => eventsSortedByTime(byDate.get(cell.key) || []));
  cells.forEach((cell, i) => allDay.appendChild(allDayCell(cell, perDay[i], handlers)));
  allDay.hidden = !perDay.some(list => list.some(evt => timeToMinutes(evt.time) === null));

  const scroll = el('div', 'tg-scroll');
  const body = el('div', 'tg-body');
  body.appendChild(gutterHours());
  cells.forEach((cell, i) => body.appendChild(dayColumn(cell, perDay[i], state, handlers)));
  scroll.appendChild(body);
  grid.append(head, allDay, scroll);

  const showsToday = cells.some(cell => cell.isToday);
  scroll.scrollTop = keepTop ?? minutesToPx(showsToday ? Math.max(0, nowMinutes() - 60) : MORNING_MINUTES);
}

// ---------- drag to move and resize ----------

/** The chip's time label while it is dragged, e.g. "09:15 – 10:00". */
function previewTime(chip, start, duration) {
  const label = chip.querySelector('.chip-time');
  if (!label) return;
  const text = `${minutesToTime(start)} – ${minutesToTime(Math.min(DAY_MINUTES - 1, start + duration))}`;
  const node = [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
  if (node) node.textContent = text;
}

function restore(ctx) {
  ctx.chip.style.transform = '';
  ctx.chip.style.height = ctx.height;
  const label = ctx.chip.querySelector('.chip-time');
  const node = label && [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
  if (node) node.textContent = ctx.timeText;
  for (const col of ctx.columns) col.classList.remove('is-drop-target');
}

/** Where the drag would put the reminder now. */
function target(ctx, { x, y, dx, dy, sx, sy }) {
  if (ctx.mode === 'resize') {
    return { duration: resizeDuration(ctx.start, ctx.duration, pxToMinutes(dy)) };
  }
  let index = hitTest(ctx.rects.map(r => ({ ...r, top: -Infinity, bottom: Infinity })), x + sx, y + sy);
  if (index < 0) index = ctx.index;
  const moved = moveEventTime({ date: ctx.date, time: minutesToTime(ctx.start) }, { dayDelta: index - ctx.index, minuteDelta: pxToMinutes(dy) });
  return { index, ...moved, start: timeToMinutes(moved.time), dx, sx };
}

/**
 * Bind once on #grid. handlers.onMoveEvent(id, patch) saves a move
 * ({date, time}) or a resize ({durationMinutes}).
 */
export function bindTimeGrid(grid, handlers) {
  makeDraggable(grid, {
    selector: '.time-grid .tg-event',
    handle: '.tg-resize',
    ignore: null, // the whole chip, title included, can be picked up
    scroller: () => grid.querySelector('.tg-scroll'),
    onStart({ item, handle }) {
      const columns = [...grid.querySelectorAll('.tg-col')];
      const index = columns.indexOf(item.closest('.tg-col'));
      if (index < 0) return null;
      const label = item.querySelector('.chip-time');
      const text = label && [...label.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
      return {
        move: false, // this code snaps the chip itself
        mode: handle ? 'resize' : 'move',
        chip: item,
        id: item.dataset.id,
        date: item.dataset.date,
        start: Number(item.dataset.start),
        duration: Number(item.dataset.duration),
        height: item.style.height,
        timeText: text ? text.textContent : '',
        columns,
        rects: columns.map(rectOf),
        index
      };
    },
    onMove(ctx, point) {
      const next = target(ctx, point);
      if (ctx.mode === 'resize') {
        ctx.chip.style.height = `${Math.max(minutesToPx(next.duration) - 2, 14)}px`;
        previewTime(ctx.chip, ctx.start, next.duration);
        return;
      }
      // Snapped: the chip jumps from column to column and 15 minutes at a time.
      const x = ctx.rects[next.index].left - ctx.rects[ctx.index].left;
      const y = minutesToPx(next.start - ctx.start);
      ctx.chip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      previewTime(ctx.chip, next.start, ctx.duration);
      ctx.columns.forEach((col, i) => col.classList.toggle('is-drop-target', i === next.index));
    },
    onDrop(ctx, point) {
      const next = target(ctx, point);
      restore(ctx);
      if (ctx.mode === 'resize') {
        if (next.duration !== ctx.duration) handlers.onMoveEvent(ctx.id, { durationMinutes: next.duration });
        return;
      }
      if (next.date !== ctx.date || next.start !== ctx.start) handlers.onMoveEvent(ctx.id, { date: next.date, time: next.time });
    },
    onCancel: restore
  });

  // Keep the "now" line current.
  setInterval(() => {
    const line = grid.querySelector('.tg-now');
    if (line) line.style.top = `${minutesToPx(nowMinutes())}px`;
  }, 60000);
}
