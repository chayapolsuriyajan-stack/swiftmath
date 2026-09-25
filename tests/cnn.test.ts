import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DigitCnn, type Manifest } from '../src/recognizer/cnn';

export function loadTestCnn(): DigitCnn {
  const m = JSON.parse(readFileSync('public/model/digits.json', 'utf8')) as Manifest;
  const buf = readFileSync('public/model/digits.bin');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new DigitCnn(m, ab);
}

describe('DigitCnn', () => {
  const fixtures = JSON.parse(readFileSync('tests/fixtures/cnn.json', 'utf8')) as {
    label: number; input: number[]; logits: number[];
  }[];
  const cnn = loadTestCnn();

  it('matches PyTorch logits', () => {
    let maxDiff = 0;
    for (const f of fixtures) {
      const out = cnn.run(Float32Array.from(f.input));
      out.logits.forEach((v, i) => (maxDiff = Math.max(maxDiff, Math.abs(v - f.logits[i]))));
    }
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('classifies fixtures correctly', () => {
    const ok = fixtures.filter((f) => {
      const p = cnn.run(Float32Array.from(f.input)).probs;
      return p.indexOf(Math.max(...p)) === f.label;
    }).length;
    expect(ok).toBeGreaterThanOrEqual(fixtures.length - 1);
  });

  it('runs fast', () => {
    const img = Float32Array.from(fixtures[0].input);
    const t = performance.now();
    for (let i = 0; i < 200; i++) cnn.run(img);
    expect((performance.now() - t) / 200).toBeLessThan(2);
  });
});
