import { test, assertEqual } from './runner.js';
import { resolveTheme, themeColor, resolveSkin, otherSkin, DEFAULT_SKIN, SKINS } from '../js/theme.js';

test('themeColor: pink in light mode, plum in dark mode', () => {
  assertEqual(themeColor('light'), '#ff6fa5');
  assertEqual(themeColor('dark'), '#1f1420');
});

test('resolveTheme follows the system when nothing is saved', () => {
  assertEqual(resolveTheme(null, true), 'dark');
  assertEqual(resolveTheme(null, false), 'light');
});

test('resolveTheme puts the saved choice ahead of the system setting', () => {
  assertEqual(resolveTheme('light', true), 'light');
  assertEqual(resolveTheme('dark', false), 'dark');
});

test('resolveTheme ignores bad saved values', () => {
  assertEqual(resolveTheme('purple', true), 'dark');
  assertEqual(resolveTheme('', false), 'light');
  assertEqual(resolveTheme(undefined, false), 'light');
  assertEqual(resolveTheme('DARK', false), 'light');
});

test('skin: Hello Kitty by default; One Piece only when saved', () => {
  assertEqual(DEFAULT_SKIN, 'hellokitty');
  assertEqual(resolveSkin(null), 'hellokitty');
  assertEqual(resolveSkin('nonsense'), 'hellokitty');
  assertEqual(resolveSkin('toString'), 'hellokitty', 'not fooled by inherited names');
  assertEqual(resolveSkin('onepiece'), 'onepiece');
  assertEqual(otherSkin('hellokitty'), 'onepiece');
  assertEqual(otherSkin('onepiece'), 'hellokitty');
  assertEqual(otherSkin(undefined), 'onepiece');
  assertEqual(SKINS.onepiece, 'One Piece');
});

test('themeColor follows the skin: ocean blue by day, night sea in dark mode', () => {
  assertEqual(themeColor('light', 'onepiece'), '#0b5ea8');
  assertEqual(themeColor('dark', 'onepiece'), '#0b1626');
  assertEqual(themeColor('light', 'hellokitty'), '#ff6fa5');
  assertEqual(themeColor('dark', 'bad'), '#1f1420');
});
