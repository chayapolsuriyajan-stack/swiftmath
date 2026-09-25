import type { Stroke } from '../src/ink/stroke';

type P = [number, number];
const ellipse = (cx: number, cy: number, rx: number, ry: number, a0 = -Math.PI / 2, a1 = a0 + 2 * Math.PI): P[] =>
  Array.from({ length: 25 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / 24;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as P;
  });

// Simple handwriting-like glyphs in a ~100x160 box (y down), one entry per stroke.
export const GLYPHS: Record<number, P[][]> = {
  0: [ellipse(50, 80, 36, 70)],
  1: [[[35, 30], [55, 10], [55, 150]]],
  2: [[[18, 45], [28, 20], [52, 10], [78, 22], [82, 52], [62, 88], [20, 150], [88, 150]]],
  3: [[[20, 25], [48, 10], [76, 22], [78, 52], [48, 76], [80, 96], [82, 130], [52, 150], [18, 136]]],
  4: [[[60, 10], [15, 105], [90, 105]], [[66, 45], [66, 150]]],
  5: [[[80, 12], [28, 12], [24, 72], [55, 62], [80, 84], [82, 124], [52, 150], [18, 138]]],
  6: [[[72, 10], [42, 38], [24, 88], [28, 134], [54, 150], [78, 132], [76, 100], [50, 86], [26, 104]]],
  7: [[[15, 15], [85, 15], [42, 150]]],
  8: [[...ellipse(50, 42, 28, 32, Math.PI / 2, (5 * Math.PI) / 2), ...ellipse(50, 112, 34, 38, -Math.PI / 2, -2.5 * Math.PI)]],
  9: [[[76, 40], [56, 14], [28, 24], [24, 56], [50, 72], [76, 56], [76, 40], [72, 150]]],
};

/** Densify polylines into timed stroke points, offset and scaled. */
export function glyph(d: number, ox = 0, oy = 0, s = 1, t0 = 0): Stroke[] {
  let t = t0;
  return GLYPHS[d].map((poly) => {
    const pts: Stroke = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
      for (let k = 0; k < n; k++)
        pts.push({ x: ox + s * (ax + ((bx - ax) * k) / n), y: oy + s * (ay + ((by - ay) * k) / n), t: (t += 4), p: 0.5 });
    }
    const [lx, ly] = poly[poly.length - 1];
    pts.push({ x: ox + s * lx, y: oy + s * ly, t: (t += 4), p: 0.5 });
    t += 80;
    return pts;
  });
}

export function number(text: string, spacing = 120): Stroke[] {
  return [...text].flatMap((c, i) => glyph(+c, i * spacing, 0, 1, i * 1000));
}
