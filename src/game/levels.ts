import { binary, hasBorrow, hasCarry, int, pick, unknown, type Op, type Problem, type Rng } from './generator.js';

export type CategoryId = 'add' | 'sub' | 'mul' | 'div' | 'mix' | 'alg';

export interface Level {
  name: string;
  /** target seconds per question for 3 stars; 2 stars at 1.6x */
  pace: number;
  make: (r: Rng) => Problem;
}

export interface Category {
  id: CategoryId;
  name: string;
  symbol: string;
  levels: Level[];
}

export const QUESTIONS = 20;
export const MISTAKE_PENALTY_MS = 2000;

const L = (name: string, pace: number, make: (r: Rng) => Problem): Level => ({ name, pace, make });

/** retry until predicate holds */
const until = <T>(r: Rng, gen: (r: Rng) => T, ok: (t: T) => boolean): T => {
  for (let i = 0; i < 200; i++) {
    const t = gen(r);
    if (ok(t)) return t;
  }
  return gen(r);
};

const add = (ra: [number, number], rb: [number, number], carry?: boolean) => (r: Rng) => {
  const [a, b] = until(r, (r) => [int(r, ...ra), int(r, ...rb)], ([a, b]) => carry === undefined || hasCarry(a, b) === carry);
  return r() < 0.5 ? binary(a, '+', b) : binary(b, '+', a);
};

const add3 = (lo: number, hi: number) => (r: Rng): Problem => {
  const a = int(r, lo, hi), b = int(r, lo, hi), c = int(r, lo, hi);
  return { parts: [a, '+', b, '+', c, '=', '□'].map(String), answer: a + b + c, key: `${a}+${b}+${c}` };
};

const sub = (ra: [number, number], rb: [number, number], borrow?: boolean) => (r: Rng) => {
  const [a, b] = until(
    r,
    (r) => [int(r, ...ra), int(r, ...rb)],
    ([a, b]) => a >= b && (borrow === undefined || hasBorrow(a, b) === borrow),
  );
  return binary(a, '−', b);
};

const mul = (tables: number[], rb: [number, number] = [0, 10]) => (r: Rng) => {
  const a = pick(r, tables), b = int(r, ...rb);
  return r() < 0.5 ? binary(a, '×', b) : binary(b, '×', a);
};

const div = (divisors: number[], rq: [number, number] = [1, 10]) => (r: Rng) => {
  const d = pick(r, divisors), q = int(r, ...rq);
  return binary(d * q, '÷', d);
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const mix = (...gens: ((r: Rng) => Problem)[]) => (r: Rng) => pick(r, gens)(r);

/** pre-algebra: build a fact, hide an operand */
const alg = (ops: Op[], small: number, big: number) => (r: Rng) => {
  const op = pick(r, ops);
  const hide = (r() < 0.5 ? 0 : 1) as 0 | 1;
  if (op === '+') return unknown(int(r, 0, big), '+', int(r, 0, big), hide);
  if (op === '−') {
    const b = int(r, 0, big), c = int(r, 0, big);
    return unknown(b + c, '−', b, hide);
  }
  if (op === '×') return unknown(int(r, 1, small), '×', int(r, 1, small), hide);
  const d = int(r, 1, small), q = int(r, 1, small);
  return unknown(d * q, '÷', d, hide);
};

export const CATEGORIES: Category[] = [
  {
    id: 'add', name: 'Addition', symbol: '+',
    levels: [
      L('Sums to 10', 1.6, (r) => until(r, add([0, 9], [0, 9]), (p) => p.answer <= 10)),
      L('Single digits', 1.8, add([1, 9], [1, 9])),
      L('Teens, no carry', 2.0, add([10, 19], [1, 9], false)),
      L('2-digit + 1-digit', 2.4, add([10, 99], [1, 9], true)),
      L('2-digit, no carry', 2.6, add([10, 89], [10, 89], false)),
      L('2-digit with carry', 3.2, add([11, 89], [11, 89], true)),
      L('2-digit, any', 3.2, add([10, 99], [10, 99])),
      L('Three singles', 3.0, add3(1, 9)),
      L('3-digit + 1-digit', 3.2, add([100, 999], [1, 9])),
      L('3-digit + 2-digit', 4.2, add([100, 999], [10, 99])),
      L('3-digit + 3-digit', 5.0, add([100, 899], [100, 899])),
      L('Three 2-digits', 5.5, add3(10, 99)),
    ],
  },
  {
    id: 'sub', name: 'Subtraction', symbol: '−',
    levels: [
      L('Within 10', 1.6, sub([1, 10], [0, 10])),
      L('Within 20', 2.0, sub([10, 20], [1, 10])),
      L('Teens, no borrow', 2.0, sub([10, 19], [1, 9], false)),
      L('Teens with borrow', 2.4, sub([11, 18], [2, 9], true)),
      L('2-digit − 1-digit', 2.6, sub([20, 99], [1, 9])),
      L('2-digit, no borrow', 2.8, sub([20, 99], [10, 89], false)),
      L('2-digit with borrow', 3.4, sub([21, 99], [11, 89], true)),
      L('2-digit, any', 3.4, sub([10, 99], [10, 99])),
      L('3-digit − 1-digit', 3.2, sub([100, 999], [1, 9])),
      L('3-digit − 2-digit', 4.4, sub([100, 999], [10, 99])),
      L('3-digit − 3-digit', 5.0, sub([200, 999], [100, 899])),
      L('From 1000', 5.0, (r) => binary(1000, '−', int(r, 1, 999))),
    ],
  },
  {
    id: 'mul', name: 'Multiplication', symbol: '×',
    levels: [
      L('× 0, 1, 2', 1.6, mul([0, 1, 2])),
      L('× 5, 10', 1.8, mul([5, 10])),
      L('× 3, 4', 2.2, mul([3, 4])),
      L('× 2 – 5', 2.2, mul([2, 3, 4, 5])),
      L('× 6, 7', 2.6, mul([6, 7])),
      L('× 8, 9', 2.6, mul([8, 9])),
      L('Tables to 10', 2.6, mul(range(2, 10), [2, 10])),
      L('× 11, 12', 3.0, mul([11, 12], [1, 12])),
      L('Tables to 12', 2.8, mul(range(2, 12), [2, 12])),
      L('2-digit × 1-digit', 4.5, (r) => binary(int(r, 11, 49), '×', int(r, 2, 9))),
      L('Big × 1-digit', 5.5, (r) => binary(int(r, 50, 99), '×', int(r, 2, 9))),
      L('2-digit × 2-digit', 8.0, (r) => binary(int(r, 11, 25), '×', int(r, 11, 19))),
    ],
  },
  {
    id: 'div', name: 'Division', symbol: '÷',
    levels: [
      L('÷ 1, 2', 1.8, div([1, 2])),
      L('÷ 5, 10', 2.0, div([5, 10])),
      L('÷ 3, 4', 2.4, div([3, 4])),
      L('÷ 2 – 5', 2.4, div([2, 3, 4, 5])),
      L('÷ 6, 7', 2.8, div([6, 7])),
      L('÷ 8, 9', 2.8, div([8, 9])),
      L('Tables to 10', 2.8, div(range(2, 10), [2, 10])),
      L('÷ 11, 12', 3.2, div([11, 12], [1, 12])),
      L('Tables to 12', 3.0, div(range(2, 12), [2, 12])),
      L('2-digit ÷ 1-digit', 4.0, div(range(2, 9), [11, 20])),
      L('3-digit ÷ 1-digit', 5.0, div(range(3, 9), [20, 99])),
      L('÷ 2-digit', 5.5, div(range(11, 25), [2, 9])),
    ],
  },
  {
    id: 'mix', name: 'Mixed', symbol: '±',
    levels: [
      L('+ − within 10', 1.8, mix(add([0, 5], [0, 5]), sub([1, 10], [0, 10]))),
      L('+ − within 20', 2.2, mix(add([1, 10], [1, 10]), sub([10, 20], [1, 10]))),
      L('× ÷ easy', 2.2, mix(mul([1, 2, 5, 10]), div([1, 2, 5, 10]))),
      L('× ÷ to 5', 2.4, mix(mul([2, 3, 4, 5]), div([2, 3, 4, 5]))),
      L('All four, small', 2.4, mix(add([1, 9], [1, 9]), sub([2, 18], [1, 9]), mul([2, 3, 4, 5]), div([2, 3, 4, 5]))),
      L('+ − 2-digit', 3.2, mix(add([10, 99], [10, 99]), sub([10, 99], [10, 99]))),
      L('× ÷ to 10', 2.8, mix(mul(range(2, 10), [2, 10]), div(range(2, 10), [2, 10]))),
      L('All four, medium', 3.2, mix(add([10, 99], [1, 9]), sub([20, 99], [1, 9]), mul(range(2, 10), [2, 10]), div(range(2, 10), [2, 10]))),
      L('× ÷ to 12', 3.0, mix(mul(range(2, 12), [2, 12]), div(range(2, 12), [2, 12]))),
      L('+ − 3-digit', 4.6, mix(add([100, 999], [10, 99]), sub([100, 999], [10, 99]))),
      L('All four, hard', 4.2, mix(add([10, 99], [10, 99]), sub([10, 99], [10, 99]), mul(range(2, 12), [2, 12]), div(range(2, 12), [2, 12]))),
      L('Master', 5.0, mix(add([100, 999], [100, 899]), sub([200, 999], [100, 899]), (r) => binary(int(r, 11, 49), '×', int(r, 2, 9)), div(range(3, 9), [20, 99]))),
    ],
  },
  {
    id: 'alg', name: 'Pre-Algebra', symbol: 'x',
    levels: [
      L('□ + b = c', 2.2, alg(['+'], 0, 9)),
      L('□ − b = c', 2.4, alg(['−'], 0, 9)),
      L('+ − unknowns', 2.6, alg(['+', '−'], 0, 10)),
      L('+ − to 20', 3.0, alg(['+', '−'], 0, 20)),
      L('× unknowns', 2.6, alg(['×'], 5, 0)),
      L('÷ unknowns', 2.8, alg(['÷'], 5, 0)),
      L('× ÷ to 10', 3.0, alg(['×', '÷'], 10, 0)),
      L('All ops, small', 3.2, alg(['+', '−', '×', '÷'], 6, 10)),
      L('+ − to 50', 3.8, alg(['+', '−'], 0, 50)),
      L('× ÷ to 12', 3.4, alg(['×', '÷'], 12, 0)),
      L('All ops, medium', 4.0, alg(['+', '−', '×', '÷'], 10, 50)),
      L('+ − to 100', 4.6, alg(['+', '−'], 0, 100)),
    ],
  },
];

export const category = (id: string) => CATEGORIES.find((c) => c.id === id);

/** 3 stars at pace, 2 stars at 1.6x pace, 1 star for finishing */
export function stars(level: Level, totalMs: number, questions = QUESTIONS): number {
  const perQ = totalMs / 1000 / questions;
  return perQ <= level.pace ? 3 : perQ <= level.pace * 1.6 ? 2 : 1;
}
