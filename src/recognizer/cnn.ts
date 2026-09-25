// Hand-written inference for the tiny digit CNN trained by scripts/train/train_digits.py.
// conv3x3(1->16) relu pool2 -> conv3x3(16->32) relu pool2 -> fc(800->64) relu -> fc(64->10)

export interface Manifest {
  version: number;
  tensors: { name: string; shape: number[]; dtype: 'int8' | 'float32'; offset: number }[];
}

interface Layer {
  w: Float32Array;
  b: Float32Array;
}

export interface CnnOutput {
  logits: Float32Array;
  probs: Float32Array;
  /** fc1 activations, used as the personal-model embedding */
  emb: Float32Array;
}

export class DigitCnn {
  private conv1: Layer;
  private conv2: Layer;
  private fc1: Layer;
  private fc2: Layer;
  // scratch buffers, reused across calls
  private a1 = new Float32Array(16 * 13 * 13);
  private a2 = new Float32Array(32 * 5 * 5);

  constructor(manifest: Manifest, bin: ArrayBuffer) {
    const get = (name: string) => {
      const t = manifest.tensors.find((t) => t.name === name);
      if (!t) throw new Error(`missing tensor ${name}`);
      const n = t.shape.reduce((a, b) => a * b, 1);
      return { t, data: t.dtype === 'int8' ? new Int8Array(bin, t.offset, n) : new Float32Array(bin, t.offset, n) };
    };
    const layer = (name: string): Layer => {
      const q = get(`${name}.w`);
      const s = get(`${name}.s`).data as Float32Array;
      const out = q.t.shape[0];
      const per = q.data.length / out;
      const w = new Float32Array(q.data.length);
      for (let o = 0; o < out; o++) for (let i = 0; i < per; i++) w[o * per + i] = q.data[o * per + i] * s[o];
      return { w, b: Float32Array.from(get(`${name}.b`).data) };
    };
    this.conv1 = layer('conv1');
    this.conv2 = layer('conv2');
    this.fc1 = layer('fc1');
    this.fc2 = layer('fc2');
  }

  run(img: Float32Array): CnnOutput {
    convReluPool(img, 1, 28, this.conv1, 16, this.a1);
    convReluPool(this.a1, 16, 13, this.conv2, 32, this.a2);
    const emb = dense(this.a2, this.fc1, 64, true);
    const logits = dense(emb, this.fc2, 10, false);
    return { logits, probs: softmax(logits), emb };
  }
}

/** valid 3x3 conv + relu + 2x2 max-pool (floor) */
function convReluPool(x: Float32Array, cin: number, n: number, l: Layer, cout: number, out: Float32Array) {
  const m = n - 2; // conv output size
  const p = m >> 1; // pooled size
  const conv = new Float32Array(m * m);
  for (let o = 0; o < cout; o++) {
    conv.fill(l.b[o]);
    for (let c = 0; c < cin; c++) {
      const wo = (o * cin + c) * 9;
      const xo = c * n * n;
      const w0 = l.w[wo], w1 = l.w[wo + 1], w2 = l.w[wo + 2];
      const w3 = l.w[wo + 3], w4 = l.w[wo + 4], w5 = l.w[wo + 5];
      const w6 = l.w[wo + 6], w7 = l.w[wo + 7], w8 = l.w[wo + 8];
      for (let y = 0; y < m; y++) {
        const r0 = xo + y * n, r1 = r0 + n, r2 = r1 + n;
        for (let xx = 0; xx < m; xx++) {
          conv[y * m + xx] +=
            w0 * x[r0 + xx] + w1 * x[r0 + xx + 1] + w2 * x[r0 + xx + 2] +
            w3 * x[r1 + xx] + w4 * x[r1 + xx + 1] + w5 * x[r1 + xx + 2] +
            w6 * x[r2 + xx] + w7 * x[r2 + xx + 1] + w8 * x[r2 + xx + 2];
        }
      }
    }
    const oo = o * p * p;
    for (let y = 0; y < p; y++)
      for (let xx = 0; xx < p; xx++) {
        const i = 2 * y * m + 2 * xx;
        const v = Math.max(conv[i], conv[i + 1], conv[i + m], conv[i + m + 1]);
        out[oo + y * p + xx] = v > 0 ? v : 0;
      }
  }
}

function dense(x: Float32Array, l: Layer, out: number, relu: boolean): Float32Array {
  const y = new Float32Array(out);
  const n = x.length;
  for (let o = 0; o < out; o++) {
    let s = l.b[o];
    const wo = o * n;
    for (let i = 0; i < n; i++) s += l.w[wo + i] * x[i];
    y[o] = relu && s < 0 ? 0 : s;
  }
  return y;
}

export function softmax(z: Float32Array): Float32Array {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  const e = new Float32Array(z.length);
  let sum = 0;
  for (let i = 0; i < z.length; i++) sum += e[i] = Math.exp(z[i] - max);
  for (let i = 0; i < z.length; i++) e[i] /= sum;
  return e;
}

let loading: Promise<DigitCnn> | null = null;

/** Fetch + build the model once (browser). */
export function loadCnn(base = import.meta.env?.BASE_URL ?? '/'): Promise<DigitCnn> {
  loading ??= Promise.all([
    fetch(`${base}model/digits.json`).then((r) => r.json() as Promise<Manifest>),
    fetch(`${base}model/digits.bin`).then((r) => r.arrayBuffer()),
  ]).then(([m, b]) => new DigitCnn(m, b));
  return loading;
}
