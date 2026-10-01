// Light / dark theme, and the skin: Hello Kitty (default) or One Piece colours
// (css/tokens.css). `resolveTheme`, `resolveSkin`, `otherSkin` and `themeColor`
// are pure and unit-tested; the rest touches the DOM and localStorage.

export const THEME_KEY = 'theme';

const THEMES = ['light', 'dark'];

/** A saved valid choice wins; otherwise follow the system setting. */
export function resolveTheme(saved, systemPrefersDark) {
  if (THEMES.includes(saved)) return saved;
  return systemPrefersDark ? 'dark' : 'light';
}

const readSavedTheme = () => readSaved(THEME_KEY);

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function currentTheme() {
  return resolveTheme(document.documentElement.dataset.theme || readSavedTheme(), systemPrefersDark());
}

// ---------- skin: Hello Kitty (default) or One Piece colours ----------

export const SKIN_KEY = 'skin';
export const DEFAULT_SKIN = 'hellokitty';
export const SKINS = { hellokitty: 'Hello Kitty', onepiece: 'One Piece' };
// The menu item shows the skin a click switches to.
const SKIN_ICONS = { hellokitty: 'fa-ribbon', onepiece: 'fa-anchor' };

/** A saved valid skin, else Hello Kitty. */
export function resolveSkin(saved) {
  return Object.hasOwn(SKINS, saved) ? saved : DEFAULT_SKIN;
}

/** The other skin: what the menu item switches to. */
export const otherSkin = skin => (resolveSkin(skin) === 'onepiece' ? 'hellokitty' : 'onepiece');

function readSaved(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

export function currentSkin() {
  return resolveSkin(document.documentElement.dataset.skin || readSaved(SKIN_KEY));
}

/** Browser/status-bar colour on phones for a theme and skin. */
export function themeColor(theme, skin = DEFAULT_SKIN) {
  if (resolveSkin(skin) === 'onepiece') return theme === 'dark' ? '#0b1626' : '#0b5ea8';
  return theme === 'dark' ? '#1f1420' : '#ff6fa5';
}

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(currentTheme(), currentSkin()));
}

/** Hello Kitty is the stylesheet's default (no attribute); One Piece sets html[data-skin]. */
export function applySkin(skin) {
  const resolved = resolveSkin(skin);
  if (resolved === DEFAULT_SKIN) delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = resolved;
  updateThemeColor();
  const button = document.querySelector('#skin-toggle');
  if (!button) return;
  const next = otherSkin(resolved);
  button.innerHTML = `<i class="fa-solid ${SKIN_ICONS[next]}" aria-hidden="true"></i> <span class="btn-label">${SKINS[next]} theme</span>`;
  button.setAttribute('aria-label', `Switch to the ${SKINS[next]} theme`);
  button.title = button.getAttribute('aria-label');
}

export function toggleSkin() {
  const next = otherSkin(currentSkin());
  try {
    localStorage.setItem(SKIN_KEY, next);
  } catch (err) {
    // still switch for this session
  }
  applySkin(next);
  return next;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  updateThemeColor();
  const button = document.querySelector('#theme-toggle');
  if (!button) return;
  const dark = theme === 'dark';
  // The icon and label (in the account menu) show where a click will take you.
  button.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i> <span class="btn-label">${dark ? 'Light mode' : 'Dark mode'}</span>`;
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = button.getAttribute('aria-label');
}

export function initTheme() {
  applyTheme(resolveTheme(readSavedTheme(), systemPrefersDark()));
  applySkin(readSaved(SKIN_KEY));
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
