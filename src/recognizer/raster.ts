import { bbox, type Stroke } from '../ink/stroke';

export const SIZE = 28;
const FIT = 20; // MNIST: digit fits a 20x20 box, centered by mass in 28x28
const RADIUS = 1.15; // pen radius in 28px space (MNIST strokes are ~2-3px wide)

type Seg = [number, number, number, number];

/** Rasterize strokes into a 28x28 MNIST-style image (values 0..1, row-major). */
export function rasterize(strokes: Stroke[]): Float32Array {
  const b = bbox(strokes);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const span = Math.max(w, h, 1e-6);
  const inner = FIT - 2 * RADIUS;
  // Tiny marks (a dot, a short dash) should not be blown up to full size.
  const scale = Math.max(w, h) < 1 ? 1 : inner / span;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;

  const segs: Seg[] = [];
  const map = (x: number, y: number, ox: number, oy: number): [number, number] => [
    (x - cx) * scale + ox,
    (y - cy) * scale + oy,
  ];
  const build = (ox: number, oy: number) => {
    segs.length = 0;
    for (const s of strokes) {
      if (s.length === 1) {
        const [x, y] = map(s[0].x, s[0].y, ox, oy);
        segs.push([x, y, x, y]);
        continue;
      }
      // Skip points closer than 0.35px in target space: keeps cost flat for 240Hz pencil input.
      let [px, py] = map(s[0].x, s[0].y, ox, oy);
      for (let i = 1; i < s.length; i++) {
        const [qx, qy] = map(s[i].x, s[i].y, ox, oy);
        if (i < s.length - 1 && Math.hypot(qx - px, qy - py) < 0.35) continue;
        segs.push([px, py, qx, qy]);
        px = qx;
        py = qy;
      }
    }
  };

  build(SIZE / 2, SIZE / 2);
  let img = draw(segs);
  // shift so the center of mass sits at the image center
  let m = 0, mx = 0, my = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = img[y * SIZE + x];
      m += v;
      mx += v * (x + 0.5);
      my += v * (y + 0.5);
    }
  if (m > 0) {
    const clamp = (v: number) => Math.max(-3, Math.min(3, v));
    const dx = clamp(SIZE / 2 - mx / m), dy = clamp(SIZE / 2 - my / m);
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      build(SIZE / 2 + dx, SIZE / 2 + dy);
      img = draw(segs);
    }
  }
  return img;
}

function draw(segs: Seg[]): Float32Array {
  const img = new Float32Array(SIZE * SIZE);
  const r = RADIUS;
  for (const [ax, ay, bx, by] of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + r + 1));
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        let t = len2 > 0 ? (px * vx + py * vy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - t * vx, py - t * vy);
        const v = r + 0.5 - d; // ~1px anti-aliased edge
        if (v > 0) {
          const i = y * SIZE + x;
          const c = v > 1 ? 1 : v;
          if (c > img[i]) img[i] = c;
        }
      }
  }
  return img;
}
