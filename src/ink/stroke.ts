export interface Point {
  x: number;
  y: number;
  t: number;
  p: number;
  /** pencil tilt 0 (upright) .. 1 (flat on its side) */
  a?: number;
}

export type Stroke = Point[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(strokes: Stroke[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}

export function pathLength(s: Stroke): number {
  let d = 0;
  for (let i = 1; i < s.length; i++) d += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  return d;
}

/** Resample all strokes (as one cloud, stroke ids kept) to n evenly spaced points. */
export function resampleCloud(strokes: Stroke[], n: number): { x: number; y: number; id: number }[] {
  const total = strokes.reduce((a, s) => a + pathLength(s), 0);
  const out: { x: number; y: number; id: number }[] = [];
  if (total === 0) {
    const p = strokes[0]?.[0] ?? { x: 0, y: 0 };
    for (let i = 0; i < n; i++) out.push({ x: p.x, y: p.y, id: 0 });
    return out;
  }
  const step = total / (n - 1);
  let acc = 0;
  strokes.forEach((s, id) => {
    if (!s.length) return;
    let px = s[0].x, py = s[0].y;
    if (out.length === 0) out.push({ x: px, y: py, id });
    for (let i = 1; i < s.length; i++) {
      let qx = s[i].x, qy = s[i].y;
      let d = Math.hypot(qx - px, qy - py);
      while (acc + d >= step && d > 0) {
        const r = (step - acc) / d;
        px = px + r * (qx - px);
        py = py + r * (qy - py);
        out.push({ x: px, y: py, id });
        d = Math.hypot(qx - px, qy - py);
        acc = 0;
      }
      acc += d;
      px = qx;
      py = qy;
    }
  });
  const last = strokes[strokes.length - 1];
  while (out.length < n) {
    const p = last[last.length - 1];
    out.push({ x: p.x, y: p.y, id: strokes.length - 1 });
  }
  return out.slice(0, n);
}
