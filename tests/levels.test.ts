import { describe, expect, it } from 'vitest';
import { draw, hasBorrow, hasCarry, SLOT } from '../src/game/generator';
import { CATEGORIES, QUESTIONS, stars } from '../src/game/levels';

const evalParts = (parts: string[], answer: number) => {
  const toks = parts.map((t) => (t === SLOT ? String(answer) : t));
  const eq = toks.indexOf('=');
  const calc = (xs: string[]) => {
    let v = +xs[0];
    for (let i = 1; i < xs.length; i += 2) {
      const n = +xs[i + 1];
      v = xs[i] === '+' ? v + n : xs[i] === '−' ? v - n : xs[i] === '×' ? v * n : v / n;
    }
    return v;
  };
  return calc(toks.slice(0, eq)) === calc(toks.slice(eq + 1));
};

describe('levels', () => {
  it('has 12 levels in 6 categories', () => {
    expect(CATEGORIES).toHaveLength(6);
    for (const c of CATEGORIES) expect(c.levels).toHaveLength(12);
  });

  for (const c of CATEGORIES)
    it(`${c.name}: every problem is valid`, () => {
      c.levels.forEach((lvl) => {
        for (let seed = 1; seed <= 20; seed++) {
          const ps = draw(lvl.make, QUESTIONS, seed);
          expect(ps).toHaveLength(QUESTIONS);
          for (const p of ps) {
            expect(Number.isInteger(p.answer), `${lvl.name} ${p.parts.join(' ')}`).toBe(true);
            expect(p.answer).toBeGreaterThanOrEqual(0);
            expect(p.answer).toBeLessThan(100000);
            expect(p.parts.filter((t) => t === SLOT)).toHaveLength(1);
            expect(evalParts(p.parts, p.answer), p.parts.join(' ')).toBe(true);
          }
        }
      });
    });

  it('is deterministic per seed', () => {
    const l = CATEGORIES[0].levels[5];
    expect(draw(l.make, 20, 42)).toEqual(draw(l.make, 20, 42));
  });

  it('carry/borrow helpers', () => {
    expect(hasCarry(15, 7)).toBe(true);
    expect(hasCarry(12, 7)).toBe(false);
    expect(hasBorrow(32, 17)).toBe(true);
    expect(hasBorrow(37, 12)).toBe(false);
  });

  it('stars from pace', () => {
    const l = CATEGORIES[0].levels[0];
    expect(stars(l, l.pace * 1000 * QUESTIONS)).toBe(3);
    expect(stars(l, l.pace * 1500 * QUESTIONS)).toBe(2);
    expect(stars(l, l.pace * 5000 * QUESTIONS)).toBe(1);
  });
});
