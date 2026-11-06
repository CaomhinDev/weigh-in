import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleSlot, niceTicks, spreadLabels, nearestBy } from "../js/chart-math.js";

test("selecting fills the first free slot", () => {
  assert.deepEqual(toggleSlot([null, null, null], 7), [7, null, null]);
  assert.deepEqual(toggleSlot([7, null, null], 8), [7, 8, null]);
});

test("deselecting keeps others (and their colours) in place", () => {
  assert.deepEqual(toggleSlot([7, 8, 9], 7), [null, 8, 9]);
  assert.deepEqual(toggleSlot([null, 8, 9], 10), [10, 8, 9]);
});

test("a fourth person can't be added", () => {
  assert.deepEqual(toggleSlot([1, 2, 3], 4), [1, 2, 3]);
});

test("nice ticks cover the range with round steps", () => {
  assert.deepEqual(niceTicks(68.3, 74.1), [68, 70, 72, 74, 76]);
  assert.deepEqual(niceTicks(70.05, 70.72), [70, 70.2, 70.4, 70.6, 70.8]);
  const single = niceTicks(80, 80);
  assert.ok(single[0] < 80 && single.at(-1) > 80);
});

test("labels are spread apart and kept in bounds", () => {
  const out = spreadLabels([100, 102, 50], 16, 0, 300);
  assert.equal(out[2], 50);
  assert.ok(out[1] - out[0] >= 16);
  const edge = spreadLabels([299, 300, 300], 16, 0, 300).sort((a, b) => a - b);
  assert.ok(edge.every((v) => v >= 0 && v <= 300));
  assert.ok(edge[1] - edge[0] >= 16 && edge[2] - edge[1] >= 16);
});

test("nearestBy picks the closest item", () => {
  assert.equal(nearestBy([1, 10, 20], (d) => d, 12), 10);
  assert.equal(nearestBy([], (d) => d, 3), null);
});
