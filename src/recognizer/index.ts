import type { Stroke } from '../ink/stroke';
import type { DigitCnn } from './cnn';
import { makeCloud, normEmb, PersonalModel, type Sample } from './personal';
import { rasterize } from './raster';
import { DEFAULT_SEGMENT, segment, type SegmentOpts } from './segment';

export interface DigitRead {
  digit: number;
  probs: Float32Array;
  emb: number[];
  cloud: number[];
  /** gap between best and second-best probability */
  margin: number;
}

export interface Reading {
  text: string;
  digits: DigitRead[];
  confidence: number;
}

export class Recognizer {
  seg: SegmentOpts = { ...DEFAULT_SEGMENT };

  constructor(
    private cnn: DigitCnn,
    public personal: PersonalModel = new PersonalModel(),
  ) {}

  readDigit(strokes: Stroke[]): DigitRead {
    const out = this.cnn.run(rasterize(strokes));
    const emb = normEmb(out.emb);
    const cloud = makeCloud(strokes);
    const probs = this.personal.fuse(out.probs, emb, cloud);
    let a = 0, b = -1;
    for (let d = 1; d < 10; d++) if (probs[d] > probs[a]) a = d;
    for (let d = 0; d < 10; d++) if (d !== a && (b < 0 || probs[d] > probs[b])) b = d;
    return { digit: a, probs, emb, cloud, margin: probs[a] - probs[b] };
  }

  read(strokes: Stroke[]): Reading {
    const digits = segment(strokes, this.seg).map((g) => this.readDigit(g));
    return {
      text: digits.map((d) => d.digit).join(''),
      digits,
      confidence: digits.length ? Math.min(...digits.map((d) => d.margin)) : 0,
    };
  }

  /** Learn a single digit whose true label is known (calibration). */
  learnDigit(d: DigitRead, label: number, source: Sample['source']): { added: Sample[]; evicted: Sample[] } {
    const s: Sample = { label, emb: d.emb, cloud: d.cloud, source, ts: Date.now() };
    return { added: [s], evicted: this.personal.add(s) };
  }

  /** Turn a confirmed reading into labelled samples. Returns them for persistence. */
  learn(reading: Reading, truth: string, source: Sample['source']): { added: Sample[]; evicted: Sample[] } {
    const added: Sample[] = [], evicted: Sample[] = [];
    if (reading.digits.length !== truth.length) return { added, evicted };
    reading.digits.forEach((d, i) => {
      const s: Sample = { label: +truth[i], emb: d.emb, cloud: d.cloud, source, ts: Date.now() };
      added.push(s);
      evicted.push(...this.personal.add(s));
    });
    return { added, evicted };
  }
}
