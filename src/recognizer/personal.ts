import { resampleCloud, type Stroke } from '../ink/stroke';

export const CLOUD_N = 32;
const MAX_LEARNED_PER_CLASS = 30;
const FULL_TRUST = 8; // samples per class at which personal model reaches max weight
const MIN_ALPHA = 0.4;

export interface Sample {
  label: number;
  emb: number[]; // L2-normalised CNN embedding
  cloud: number[]; // flattened [x0,y0,x1,y1,...], centroid-centred, size-normalised
  source: 'calib' | 'learned';
  ts: number;
}

type Cloud = Float32Array;

export function normEmb(e: Float32Array): number[] {
  let n = 0;
  for (const v of e) n += v * v;
  n = Math.sqrt(n) || 1;
  return Array.from(e, (v) => v / n);
}

export function makeCloud(strokes: Stroke[]): number[] {
  const pts = resampleCloud(strokes, CLOUD_N);
  let cx = 0, cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  // preserve aspect ratio: a "1" must stay thin
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const out: number[] = [];
  for (const p of pts) out.push((p.x - cx) / s, (p.y - cy) / s);
  return out;
}

/** $P greedy point-cloud distance (Vatavu et al.), symmetric. */
function cloudDistance(a: Cloud, b: Cloud): number {
  return Math.min(greedy(a, b), greedy(b, a));
}

function greedy(a: Cloud, b: Cloud): number {
  const n = a.length / 2;
  const step = Math.max(1, n >> 2); // 4 starting points is plenty for 32-point clouds
  let best = Infinity;
  for (let start = 0; start < n; start += step) {
    const used = new Uint8Array(n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      let min = Infinity, idx = 0;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const dx = a[2 * i] - b[2 * j], dy = a[2 * i + 1] - b[2 * j + 1];
        const d = dx * dx + dy * dy;
        if (d < min) {
          min = d;
          idx = j;
        }
      }
      used[idx] = 1;
      sum += (1 - k / n) * Math.sqrt(min);
      if (sum >= best) break;
    }
    if (sum < best) best = sum;
  }
  return best;
}

export class PersonalModel {
  private samples: Sample[] = [];
  private clouds: Cloud[] = [];

  constructor(samples: Sample[] = []) {
    for (const s of samples) this.push(s);
  }

  get all(): readonly Sample[] {
    return this.samples;
  }

  count(label: number): number {
    let n = 0;
    for (const s of this.samples) if (s.label === label) n++;
    return n;
  }

  private push(s: Sample) {
    this.samples.push(s);
    this.clouds.push(Float32Array.from(s.cloud));
  }

  add(s: Sample): Sample[] {
    this.push(s);
    // FIFO-evict learned samples beyond the cap; calibration samples are kept.
    const learned = this.samples.filter((x) => x.label === s.label && x.source === 'learned');
    const evicted: Sample[] = [];
    while (learned.length > MAX_LEARNED_PER_CLASS) {
      const old = learned.shift()!;
      const i = this.samples.indexOf(old);
      this.samples.splice(i, 1);
      this.clouds.splice(i, 1);
      evicted.push(old);
    }
    return evicted;
  }

  clear() {
    this.samples = [];
    this.clouds = [];
  }

  /** Fuse CNN probabilities with the user's own samples. */
  fuse(pCnn: Float32Array, emb: number[], cloud: number[]): Float32Array {
    if (!this.samples.length) return pCnn;
    const c = Float32Array.from(cloud);
    // cheap pass: embedding cosine against every sample
    const byClass: { cos: number; i: number }[][] = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      let cos = 0;
      for (let k = 0; k < emb.length; k++) cos += emb[k] * s.emb[k];
      byClass[s.label].push({ cos, i });
    }
    // expensive $P shape match only on each class's 3 nearest samples
    const sampled: number[] = [];
    const score = new Float32Array(10);
    for (let d = 0; d < 10; d++) {
      if (!byClass[d].length) continue;
      const top = byClass[d].sort((a, b) => b.cos - a.cos).slice(0, 3);
      let s = 0;
      for (const t of top) s += 0.6 * t.cos + 0.4 * Math.exp(-cloudDistance(c, this.clouds[t.i]) / 1.2);
      score[d] = s / top.length;
      sampled.push(d);
    }
    const best = byClass;
    // personal distribution over sampled classes, carrying the CNN's mass for those classes
    let mass = 0, z = 0;
    const tau = 14;
    const pers = new Float32Array(10);
    for (const d of sampled) {
      mass += pCnn[d];
      z += pers[d] = Math.exp(tau * score[d]);
    }
    const out = new Float32Array(10);
    let sum = 0;
    for (let d = 0; d < 10; d++) {
      const n = best[d].length;
      const alpha = 1 - (1 - MIN_ALPHA) * Math.min(1, n / FULL_TRUST);
      const p = n ? (pers[d] / z) * Math.max(mass, 0.5) : pCnn[d];
      sum += out[d] = alpha * pCnn[d] + (1 - alpha) * p;
    }
    for (let d = 0; d < 10; d++) out[d] /= sum;
    return out;
  }
}
