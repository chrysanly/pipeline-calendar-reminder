import { test, assertEqual } from './runner.js';
import {
  snapMinutes, edgeSpeed, hitTest, pressDecision, distance,
  LONG_PRESS_MS, TOUCH_SLOP, MOUSE_SLOP, EDGE_ZONE, EDGE_SPEED
} from '../js/drag.js';

test('drag: a touch waits 180ms before it picks an item up', () => {
  assertEqual(LONG_PRESS_MS, 180);
});

test('snapMinutes rounds to the nearest 15 minutes, or another step', () => {
  assertEqual(snapMinutes(7), 0);
  assertEqual(snapMinutes(8), 15);
  assertEqual(snapMinutes(52), 45);
  assertEqual(snapMinutes(-8), -15);
  assertEqual(snapMinutes(40, 30), 30);
  assertEqual(snapMinutes(45, 30), 60);
});

test('pressDecision: a mouse or pen drags once it moved past the slop', () => {
  assertEqual(pressDecision('mouse', MOUSE_SLOP), 'wait');
  assertEqual(pressDecision('mouse', MOUSE_SLOP + 1), 'drag');
  assertEqual(pressDecision('pen', 10), 'drag');
});

test('pressDecision: a touch that moves before the long-press is a scroll, never a drag', () => {
  assertEqual(pressDecision('touch', 3), 'wait');
  assertEqual(pressDecision('touch', TOUCH_SLOP), 'wait');
  assertEqual(pressDecision('touch', TOUCH_SLOP + 1), 'scroll');
  assertEqual(pressDecision('touch', 200), 'scroll');
});

test('distance is the straight-line length', () => {
  assertEqual(distance(3, 4), 5);
  assertEqual(distance(0, 0), 0);
});

test('edgeSpeed: no auto-scroll in the middle', () => {
  assertEqual(edgeSpeed(300, 0, 600), 0);
  assertEqual(edgeSpeed(EDGE_ZONE, 0, 600), 0);
});

test('edgeSpeed: scrolls back near the start and on near the end, faster at the edge', () => {
  assertEqual(edgeSpeed(0, 0, 600), -EDGE_SPEED);
  assertEqual(edgeSpeed(600, 0, 600), EDGE_SPEED);
  const near = edgeSpeed(40, 0, 600);
  const nearer = edgeSpeed(10, 0, 600);
  assertEqual(near < 0 && nearer < near, true);
  assertEqual(edgeSpeed(590, 0, 600) > edgeSpeed(560, 0, 600), true);
  // Past the edge (outside the scroller) is full speed, not faster.
  assertEqual(edgeSpeed(-100, 0, 600), -EDGE_SPEED);
});

test('edgeSpeed: a scroller too small for two zones never auto-scrolls', () => {
  assertEqual(edgeSpeed(5, 0, EDGE_ZONE * 2), 0);
});

test('hitTest finds the box under the point, or -1', () => {
  const columns = [
    { left: 0, top: 0, right: 100, bottom: 500 },
    { left: 110, top: 0, right: 210, bottom: 500 }
  ];
  assertEqual(hitTest(columns, 50, 20), 0);
  assertEqual(hitTest(columns, 150, 499), 1);
  assertEqual(hitTest(columns, 105, 20), -1); // the gap between columns
  assertEqual(hitTest(columns, 100, 20), -1); // right edge belongs to the gap
  assertEqual(hitTest(columns, 50, 600), -1);
  assertEqual(hitTest([], 1, 1), -1);
});
