export const MAX_CHART_PEOPLE = 3;

/**
 * Chart selection is a fixed list of slots, each owning a colour, so a person
 * keeps their colour while others are added or removed. Selecting fills the
 * first empty slot (null); deselecting empties theirs; a full list is unchanged.
 */
export function toggleSlot(slots, personId) {
  const next = [...slots];
  const current = next.indexOf(personId);
  if (current >= 0) {
    next[current] = null;
    return next;
  }
  const free = next.indexOf(null);
  if (free >= 0) next[free] = personId;
  return next;
}

/** "Nice" round axis ticks covering [min, max], e.g. 68.3..74.1 -> 68, 70 ... 76. */
export function niceTicks(min, max, target = 5) {
  let lo = min;
  let hi = max;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const rawStep = (hi - lo) / Math.max(1, target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const count = Math.round((end - start) / step);
  // Round to kill floating-point drift such as 70.00000001.
  return Array.from({ length: count + 1 }, (_, i) => Math.round((start + i * step) * 1e6) / 1e6);
}

/**
 * Nudges label centre positions apart so no two are closer than minGap while
 * staying inside [top, bottom]. Returns positions in the input order.
 */
export function spreadLabels(ys, minGap, top, bottom) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const placed = new Array(ys.length);
  let prev = -Infinity;
  for (const i of order) {
    placed[i] = Math.max(ys[i], prev + minGap, top);
    prev = placed[i];
  }
  // If the stack ran off the bottom, push it back up.
  let next = Infinity;
  for (const i of [...order].reverse()) {
    placed[i] = Math.min(placed[i], next - minGap, bottom);
    next = placed[i];
  }
  return placed;
}

/** The item whose key is closest to target, or null for an empty list. */
export function nearestBy(items, key, target) {
  let best = null;
  let bestDist = Infinity;
  for (const item of items) {
    const d = Math.abs(key(item) - target);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}
