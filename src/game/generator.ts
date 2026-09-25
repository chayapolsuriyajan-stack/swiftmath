export interface Problem {
  /** display tokens; SLOT marks where the handwritten answer goes */
  parts: string[];
  answer: number;
  key: string;
}

export const SLOT = '□';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const digitsOf = (n: number) => String(n).split('').reverse().map(Number);

/** true if adding a and b produces a carry in any column */
export function hasCarry(a: number, b: number): boolean {
  const x = digitsOf(a), y = digitsOf(b);
  let c = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const s = (x[i] ?? 0) + (y[i] ?? 0) + c;
    if (s >= 10) return true;
    c = 0;
  }
  return false;
}

/** true if a - b requires borrowing in any column */
export function hasBorrow(a: number, b: number): boolean {
  const x = digitsOf(a), y = digitsOf(b);
  return y.some((d, i) => d > (x[i] ?? 0));
}

export type Op = '+' | '−' | '×' | '÷';

export const fmt = (parts: (string | number)[]): Problem['parts'] => parts.map(String);

export function binary(a: number, op: Op, b: number): Problem {
  const answer = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b;
  return { parts: fmt([a, op, b, '=', SLOT]), answer, key: `${a}${op}${b}` };
}

/** Pre-algebra: hide one operand instead of the result. */
export function unknown(a: number, op: Op, b: number, hide: 0 | 1): Problem {
  const c = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b;
  const parts = hide === 0 ? [SLOT, op, b, '=', c] : [a, op, SLOT, '=', c];
  return { parts: fmt(parts), answer: hide === 0 ? a : b, key: `${parts.join('')}` };
}

/** Draw `n` problems, avoiding immediate repeats. */
export function draw(make: (r: Rng) => Problem, n: number, seed: number): Problem[] {
  const r = mulberry32(seed);
  const out: Problem[] = [];
  const recent = new Set<string>();
  for (let tries = 0; out.length < n && tries < n * 50; tries++) {
    const p = make(r);
    if (recent.has(p.key) && tries < n * 40) continue;
    out.push(p);
    recent.add(p.key);
    if (recent.size > 6) recent.delete(out[out.length - 7].key);
  }
  return out;
}
