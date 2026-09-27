// Pure helpers exported by js/ui.js (importing it touches no DOM).

import { test, assertEqual } from './runner.js';
import { swipeDirection } from '../js/ui.js';

test('swipeDirection: a clear swipe left is next, right is previous', () => {
  assertEqual(swipeDirection(-120, 5), 1);
  assertEqual(swipeDirection(120, -5), -1);
  assertEqual(swipeDirection(-61, 39), 1);
});

test('swipeDirection: a tap is not a swipe', () => {
  assertEqual(swipeDirection(0, 0), 0);
  assertEqual(swipeDirection(4, -3), 0);
});

test('swipeDirection: a vertical scroll is not a swipe', () => {
  assertEqual(swipeDirection(10, 200), 0);
  assertEqual(swipeDirection(-5, -300), 0);
});

test('swipeDirection: a diagonal drag is not a swipe', () => {
  assertEqual(swipeDirection(-150, 40), 0);
  assertEqual(swipeDirection(150, -90), 0);
});

test('swipeDirection: exactly 60px sideways is not enough', () => {
  assertEqual(swipeDirection(-60, 0), 0);
  assertEqual(swipeDirection(60, 0), 0);
  assertEqual(swipeDirection(-60.5, 0), 1);
});
