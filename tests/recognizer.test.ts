import { describe, expect, it } from 'vitest';
import { Recognizer } from '../src/recognizer';
import { segment } from '../src/recognizer/segment';
import { glyph, number } from './glyphs';
import { loadTestCnn } from './cnn.test';

const rec = new Recognizer(loadTestCnn());

describe('segment', () => {
  it('keeps a two-stroke 4 together', () => expect(segment(glyph(4))).toHaveLength(1));
  it('splits 11 and 17', () => {
    expect(segment(number('11', 70))).toHaveLength(2);
    expect(segment(number('17'))).toHaveLength(2);
  });
  it('splits 408', () => expect(segment(number('408'))).toHaveLength(3));
});

describe('recognizer', () => {
  it('reads synthetic single digits', () => {
    const wrong: string[] = [];
    for (let d = 0; d < 10; d++) {
      const r = rec.read(glyph(d, 10, 10, 1.3));
      if (r.text !== String(d)) wrong.push(`${d}->${r.text}`);
    }
    expect(wrong).toEqual([]);
  });

  it('reads multi-digit numbers', () => {
    for (const n of ['12', '56', '408', '97', '31']) expect(rec.read(number(n)).text).toBe(n);
  });

  it('learns a personal glyph', () => {
    // A "7" drawn with a crossbar-less hook that the base CNN may confuse; teach it as 7.
    const weird = [[{ x: 0, y: 0, t: 0, p: 0.5 }, { x: 60, y: 0, t: 1, p: 0.5 }, { x: 60, y: 40, t: 2, p: 0.5 }, { x: 58, y: 150, t: 3, p: 0.5 }]];
    const personal = new Recognizer(loadTestCnn());
    const r0 = personal.read(weird);
    for (let i = 0; i < 8; i++) personal.learn(personal.read(weird), '7', 'calib');
    const r1 = personal.read(weird);
    expect(r1.text).toBe('7');
    expect(r1.digits[0].probs[7]).toBeGreaterThan(r0.digits[0].probs[7]);
  });

  it('is fast', () => {
    const s = number('408');
    const t = performance.now();
    for (let i = 0; i < 50; i++) rec.read(s);
    expect((performance.now() - t) / 50).toBeLessThan(10);
  });
});
