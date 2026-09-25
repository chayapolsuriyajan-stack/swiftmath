import { bbox, pathLength, type Stroke } from '../ink/stroke';

export interface SegmentOpts {
  /** merge two groups when their x-overlap exceeds this fraction of the narrower one */
  mergeOverlap: number;
}

export const DEFAULT_SEGMENT: SegmentOpts = { mergeOverlap: 0.45 };

interface Group {
  strokes: Stroke[];
  minX: number;
  maxX: number;
}

/** Split handwritten strokes into per-digit clusters, left to right. */
export function segment(strokes: Stroke[], opts: SegmentOpts = DEFAULT_SEGMENT): Stroke[][] {
  const live = strokes.filter((s) => s.length > 0);
  if (!live.length) return [];
  const all = bbox(live);
  const height = Math.max(all.maxY - all.minY, 1);
  // Thin strokes (a "1") get a minimum width so overlap ratios stay meaningful.
  const minW = height * 0.12;

  const groups: Group[] = live
    .map((s) => {
      const b = bbox([s]);
      const c = (b.minX + b.maxX) / 2;
      const w = Math.max(b.maxX - b.minX, minW);
      return { strokes: [s], minX: c - w / 2, maxX: c + w / 2 };
    })
    .sort((a, b) => a.minX - b.minX);

  // Repeatedly merge the most-overlapping neighbouring pair until none pass the threshold.
  for (;;) {
    let best = -1, bestFrac = opts.mergeOverlap;
    for (let i = 0; i < groups.length - 1; i++) {
      const a = groups[i], b = groups[i + 1];
      const ov = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const frac = ov / Math.min(a.maxX - a.minX, b.maxX - b.minX);
      if (frac > bestFrac) {
        bestFrac = frac;
        best = i;
      }
    }
    if (best < 0) break;
    const a = groups[best], b = groups[best + 1];
    groups.splice(best, 2, {
      strokes: [...a.strokes, ...b.strokes],
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
    });
    groups.sort((x, y) => x.minX - y.minX);
  }

  // Drop specks (accidental taps) that are tiny relative to the writing.
  return groups
    .map((g) => g.strokes.sort((s, t) => s[0].t - t[0].t))
    .filter((g) => {
      const b = bbox(g);
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      return size > height * 0.08 || g.reduce((a, s) => a + pathLength(s), 0) > height * 0.15;
    });
}

/** Dense back-and-forth scribble over existing ink => erase gesture. */
export function isScratchOut(s: Stroke, inkHeight: number): boolean {
  if (s.length < 12) return false;
  const b = bbox([s]);
  const w = b.maxX - b.minX;
  if (w < inkHeight * 0.5) return false;
  let reversals = 0, dir = 0;
  for (let i = 3; i < s.length; i += 3) {
    const dx = s[i].x - s[i - 3].x;
    if (Math.abs(dx) < 2) continue;
    const d = Math.sign(dx);
    if (dir && d !== dir) reversals++;
    dir = d;
  }
  return reversals >= 5 && pathLength(s) > 3.5 * w;
}
