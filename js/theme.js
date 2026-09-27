// Light / dark theme. `resolveTheme` is pure and unit-tested; the rest touches
// the DOM and localStorage.

export const THEME_KEY = 'theme';

const THEMES = ['light', 'dark'];

/** A saved valid choice wins; otherwise follow the system setting. */
export function resolveTheme(saved, systemPrefersDark) {
  if (THEMES.includes(saved)) return saved;
  return systemPrefersDark ? 'dark' : 'light';
}

function readSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (err) {
    return null;
  }
}

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function currentTheme() {
  return resolveTheme(document.documentElement.dataset.theme || readSavedTheme(), systemPrefersDark());
}

/** Browser/status-bar colour on phones: bow pink by day, plum at night. */
export function themeColor(theme) {
  return theme === 'dark' ? '#1f1420' : '#ff6fa5';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(theme));
  const button = document.querySelector('#theme-toggle');
  if (!button) return;
  const dark = theme === 'dark';
  // The icon shows where a click will take you.
  button.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i>`;
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = button.getAttribute('aria-label');
}

export function initTheme() {
  applyTheme(resolveTheme(readSavedTheme(), systemPrefersDark()));
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (err) {
    // still switch for this session
  }
  applyTheme(next);
  return next;
}
