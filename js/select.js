// Searchable select (Select2-style, no jQuery): type to filter a list of
// options, pick with a tap, a click or the keyboard (↑ ↓ Enter Escape).
// Follows the WAI-ARIA combobox pattern so screen readers announce it.
//
// createCombobox(input, …) turns a text input into one; enhanceSelect(select)
// puts one in front of a <select> and keeps the select as the value.

import { el, icon } from './ui.js';

let comboCount = 0;
// <select> → its combobox, so renders can refresh it (refreshSelect).
const enhanced = new WeakMap();

/**
 * Options whose label contains every typed word (any case), the ones that
 * start with the query first; a blank query keeps them all.
 * @param {{value: string, label: string}[]} options
 */
export function filterOptions(options, query = '') {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return options.slice();
  const words = needle.split(/\s+/);
  const hits = options.filter(o => words.every(w => o.label.toLowerCase().includes(w)));
  const starts = hits.filter(o => o.label.toLowerCase().startsWith(needle));
  return [...starts, ...hits.filter(o => !starts.includes(o))];
}

/** The next highlighted index for ↑ / ↓, wrapping round; -1 when nothing is listed. */
export function moveActive(index, delta, count) {
  if (!count) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (index + delta + count) % count;
}

/**
 * Make `input` a combobox. getOptions() → [{value, label}] is read each time
 * the list opens; onPick(option) runs when one is chosen (the input shows its label).
 * @returns {{open: Function, close: Function, isOpen: () => boolean}}
 */
export function createCombobox(input, { getOptions, onPick = () => {}, emptyText = 'No matches' }) {
  const id = `combo-${++comboCount}`;
  const wrap = el('span', 'combo');
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  // A dropdown chevron inside the field, like a <select> (css/pickers.css).
  const chevron = icon('fa-chevron-down');
  chevron.classList.add('combo-chevron');
  wrap.appendChild(chevron);
  const list = el('ul', 'combo-list');
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';
  input.removeAttribute('list');

  let shown = [];
  let active = -1;

  function highlight(index) {
    active = index;
    [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
    const node = list.children[active];
    if (node && node.id) {
      input.setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function open(query = input.value) {
    wrap.classList.add('is-open');
    shown = filterOptions(getOptions(), query);
    list.innerHTML = '';
    shown.forEach((option, i) => {
      const item = el('li', 'combo-option', option.label);
      item.id = `${id}-${i}`;
      item.setAttribute('role', 'option');
      item.dataset.value = option.value;
      list.appendChild(item);
    });
    if (!shown.length) list.appendChild(el('li', 'combo-empty', emptyText));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(shown.length && query.trim() ? 0 : -1);
  }

  function close() {
    wrap.classList.remove('is-open');
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function pick(option) {
    input.value = option.label;
    close();
    onPick(option);
  }

  input.addEventListener('focus', () => {
    input.select();
    open('');
  });
  // Still focused after a pick: a click opens the list again.
  input.addEventListener('click', () => {
    if (list.hidden) open('');
  });
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) open('');
      highlight(moveActive(active, e.key === 'ArrowDown' ? 1 : -1, shown.length));
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && !list.hidden) {
      // Close the list only, not the dialog around it; and keep a search
      // input's text (its default Escape clears it and reopens the list).
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  });
  // pointerdown keeps the focus in the input, so blur doesn't close the list first.
  list.addEventListener('pointerdown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const item = e.target.closest('.combo-option');
    if (item) pick(shown[Number(item.id.slice(id.length + 1))]);
  });

  return { open, close, isOpen: () => !list.hidden };
}

const selectOptions = select => [...select.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
const selectedLabel = select => (select.selectedOptions[0] ? select.selectedOptions[0].textContent.trim() : '');

/**
 * A searchable input in front of `select` (which is hidden and keeps the
 * value): picking sets select.value and fires its 'change' event.
 */
export function enhanceSelect(select, { placeholder = 'Type to search…' } = {}) {
  if (enhanced.has(select)) return enhanced.get(select);
  const input = el('input', `combo-input ${select.className}`);
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choose');
  if (select.id) input.id = `${select.id}-search`;
  select.parentNode.insertBefore(input, select);
  select.hidden = true;
  select.tabIndex = -1;
  const combo = createCombobox(input, {
    getOptions: () => selectOptions(select),
    onPick(option) {
      if (select.value === option.value) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  // Nothing picked: show the select's current choice again.
  input.addEventListener('blur', () => { input.value = selectedLabel(select); });
  const entry = { input, combo };
  enhanced.set(select, entry);
  refreshSelect(select);
  return entry;
}

/** After code changed the select's value or options: show its current choice. */
export function refreshSelect(select) {
  const entry = enhanced.get(select);
  if (entry && document.activeElement !== entry.input) entry.input.value = selectedLabel(select);
}
