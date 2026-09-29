// App-styled dropdown for plain <select>s (Select2-style, no jQuery). A select
// marked data-picker keeps its place, look and value: clicking, tapping or
// pressing Enter / Space / ↓ on it opens this menu instead of the browser's.
// Picking sets select.value and fires 'change', so the code around it works
// as before. One shared menu, built only when opened: a Board with thousands
// of cards costs nothing extra. data-picker="status" adds the status dots.
//
// installSelectMenus() once at start-up (app.js); markSelectMenu(select) marks one.

import { el, icon } from './ui.js';
import { filterOptions, moveActive } from './select.js';

/** Over this many options the menu gets a search box. */
export const MENU_SEARCH_OVER = 6;

export const menuNeedsSearch = count => count > MENU_SEARCH_OVER;

/** The keys that open a closed select's menu. */
export function opensMenu(key, altKey = false) {
  return key === 'Enter' || key === ' ' || key === 'F4' || key === 'ArrowDown' || key === 'ArrowUp' || (altKey && key === 'ArrowDown');
}

/**
 * Where the menu goes: under the select, or above it when there is not
 * enough room below. Sizes in px; returns {top, left, width, maxHeight, above}.
 */
export function menuPlacement(rect, viewport, { gap = 6, want = 320, minWidth = 200 } = {}) {
  const width = Math.min(Math.max(rect.width, minWidth), viewport.width - 16);
  const left = Math.max(8, Math.min(rect.left, viewport.width - width - 8));
  const below = viewport.height - rect.bottom - gap - 8;
  const aboveRoom = rect.top - gap - 8;
  const above = below < Math.min(want, 200) && aboveRoom > below;
  const maxHeight = Math.max(120, Math.min(want, above ? aboveRoom : below));
  const top = above ? rect.top - gap - maxHeight : rect.bottom + gap;
  return { top, left, width, maxHeight, above };
}

/** Mark a select so it opens the app menu (idempotent). */
export function markSelectMenu(select, kind = '') {
  select.dataset.picker = kind;
  return select;
}

const PHONE_QUERY = '(max-width: 640px)';
const menuState = { select: null, pop: null, search: null, list: null, shown: [], active: -1 };

const menuOptions = select => [...select.options].filter(o => !o.hidden)
  .map(o => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled }));

function buildMenu() {
  const pop = el('div', 'menu-pop');
  pop.hidden = true;
  const backdrop = el('div', 'menu-backdrop');
  const sheet = el('div', 'menu-sheet');
  sheet.setAttribute('role', 'dialog');
  const search = el('input', 'menu-search');
  search.type = 'search';
  search.placeholder = 'Type to search…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search the options');
  const list = el('ul', 'menu-list');
  list.id = 'menu-list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  sheet.append(search, list);
  pop.append(backdrop, sheet);
  document.body.appendChild(pop);
  Object.assign(menuState, { pop, sheet, search, list });

  backdrop.addEventListener('click', () => closeMenu());
  search.addEventListener('input', () => renderMenu(search.value));
  sheet.addEventListener('keydown', onMenuKey);
  list.addEventListener('pointerdown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const item = e.target.closest('.menu-option');
    if (item && !item.classList.contains('is-disabled')) pickMenu(Number(item.dataset.index));
  });
}

function renderMenu(query = '') {
  const { select, list } = menuState;
  menuState.shown = filterOptions(menuOptions(select), query);
  list.innerHTML = '';
  menuState.shown.forEach((option, i) => {
    const item = el('li', 'menu-option');
    item.id = `menu-option-${i}`;
    item.dataset.index = String(i);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.value === select.value));
    if (option.disabled) {
      item.classList.add('is-disabled');
      item.setAttribute('aria-disabled', 'true');
    }
    if (select.dataset.picker === 'status') {
      item.classList.add(`status-${option.value}`);
      item.appendChild(el('span', 'menu-dot'));
    }
    item.appendChild(el('span', 'menu-label', option.label));
    if (option.value === select.value) item.appendChild(icon('fa-check'));
    list.appendChild(item);
  });
  if (!menuState.shown.length) list.appendChild(el('li', 'menu-empty', 'No matches'));
  const current = menuState.shown.findIndex(o => o.value === select.value);
  highlightMenu(query ? 0 : current);
}

function highlightMenu(index) {
  const { list } = menuState;
  menuState.active = menuState.shown.length ? Math.max(0, Math.min(index, menuState.shown.length - 1)) : -1;
  for (const node of list.querySelectorAll('.menu-option.is-active')) node.classList.remove('is-active');
  const node = list.children[menuState.active];
  if (node && node.classList.contains('menu-option')) {
    node.classList.add('is-active');
    list.setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView({ block: 'nearest' });
  } else {
    list.removeAttribute('aria-activedescendant');
  }
}

function placeMenu() {
  const { select, pop, sheet, list } = menuState;
  const phone = window.matchMedia(PHONE_QUERY).matches;
  pop.classList.toggle('is-sheet', phone);
  if (phone) {
    sheet.style.cssText = '';
    list.style.maxHeight = '';
    return;
  }
  const place = menuPlacement(select.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
  sheet.style.cssText = `top:${place.top}px;left:${place.left}px;width:${place.width}px;`;
  list.style.maxHeight = `${place.maxHeight - (menuState.search.hidden ? 0 : 56)}px`;
  pop.classList.toggle('is-above', place.above);
}

export function openMenu(select) {
  if (select.disabled) return;
  if (!menuState.pop) buildMenu();
  if (menuState.select) closeMenu(false);
  menuState.select = select;
  const count = menuOptions(select).length;
  const { pop, search, list, sheet } = menuState;
  search.hidden = !menuNeedsSearch(count);
  search.value = '';
  const label = select.getAttribute('aria-label') || (select.closest('label') && select.closest('label').firstChild.textContent.trim()) || 'Choose';
  sheet.setAttribute('aria-label', label);
  list.setAttribute('aria-label', label);
  renderMenu('');
  pop.hidden = false;
  select.setAttribute('aria-expanded', 'true');
  select.classList.add('is-menu-open');
  placeMenu();
  (search.hidden ? list : search).focus({ preventScroll: true });
}

export function closeMenu(returnFocus = true) {
  const { select, pop } = menuState;
  if (!select) return;
  pop.hidden = true;
  select.setAttribute('aria-expanded', 'false');
  select.classList.remove('is-menu-open');
  menuState.select = null;
  if (returnFocus) select.focus({ preventScroll: true });
}

function pickMenu(index) {
  const option = menuState.shown[index];
  const { select } = menuState;
  if (!option || option.disabled || !select) return;
  closeMenu();
  if (select.value === option.value) return;
  select.value = option.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function onMenuKey(e) {
  if (e.key === 'Escape') {
    // Close the menu only, not the dialog it opened from.
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    highlightMenu(moveActive(menuState.active, e.key === 'ArrowDown' ? 1 : -1, menuState.shown.length));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    highlightMenu(e.key === 'Home' ? 0 : menuState.shown.length - 1);
  } else if (e.key === 'Enter' || (e.key === ' ' && menuState.search.hidden)) {
    e.preventDefault();
    pickMenu(menuState.active);
  } else if (e.key === 'Tab') {
    closeMenu(false);
  }
  // The page's shortcuts stay out of the menu.
  e.stopPropagation();
}

const pickerOf = target => (target && target.closest ? target.closest('select[data-picker]') : null);

/** Once: every select[data-picker] on the page opens the app menu. */
export function installSelectMenus(root = document) {
  if (root.__selectMenus) return;
  root.__selectMenus = true;
  // Mouse: stop the browser's own list and open ours.
  root.addEventListener('mousedown', e => {
    const select = pickerOf(e.target);
    if (!select || e.button !== 0) return;
    e.preventDefault();
    select.focus({ preventScroll: true });
    if (menuState.select === select) closeMenu();
    else openMenu(select);
  });
  // Touch: the same on a tap (no native wheel); a swipe that scrolls past a select doesn't open it.
  let touchStart = null;
  root.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    touchStart = pickerOf(e.target) && touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, { passive: true });
  root.addEventListener('touchend', e => {
    const select = pickerOf(e.target);
    const touch = e.changedTouches[0];
    if (!select || !touchStart || !touch) return;
    const moved = Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y);
    touchStart = null;
    if (moved > 10) return;
    e.preventDefault();
    openMenu(select);
  }, { passive: false });
  root.addEventListener('keydown', e => {
    const select = pickerOf(e.target);
    if (!select || menuState.select === select || !opensMenu(e.key, e.altKey)) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(select);
  }, true);
  root.addEventListener('pointerdown', e => {
    if (menuState.select && !menuState.pop.contains(e.target) && pickerOf(e.target) !== menuState.select) closeMenu(false);
  }, true);
  window.addEventListener('resize', () => closeMenu(false));
  // The page (or a dialog) scrolls: the menu follows its select, and closes once it is off screen.
  let frame = 0;
  window.addEventListener('scroll', e => {
    if (!menuState.select || menuState.pop.contains(e.target) || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!menuState.select) return;
      const rect = menuState.select.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) closeMenu(false);
      else placeMenu();
    });
  }, true);
}
