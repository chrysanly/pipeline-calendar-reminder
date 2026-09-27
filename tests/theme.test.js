import { test, assertEqual } from './runner.js';
import { resolveTheme, themeColor } from '../js/theme.js';

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
