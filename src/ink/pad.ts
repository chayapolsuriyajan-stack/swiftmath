import type { Point, Stroke } from './stroke';

export interface PadOptions {
  /** decide whether a pointer type may draw (palm rejection) */
  accept: (e: PointerEvent) => boolean;
  onPen?: () => void;
  onStrokeStart?: () => void;
  onStrokeEnd?: (s: Stroke) => void;
}

interface Active {
  id: number;
  stroke: Stroke;
  drawn: number;
  pen: boolean;
}

/** grain densities: light (tilted / soft touch) .. heavy (pressed hard) */
const DENSITY = [0.42, 0.6, 0.78, 0.93];
const GRAIN = 96;

/**
 * Pencil-like ink surface.
 * - ink drawn synchronously per input event (coalesced events = full Pencil sample rate)
 * - predicted events drawn on an overlay each frame
 * - graphite grain via opaque/transparent pattern pixels (overlaps don't darken into blobs)
 * - pressure -> darkness + width, tilt -> broad light shading
 * - hover dot for Pencil hover, gentle fade-out on clear
 */
export class InkPad {
  readonly el: HTMLDivElement;
  strokes: Stroke[] = [];
  private ink: HTMLCanvasElement;
  private tip: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tctx: CanvasRenderingContext2D;
  private active: Active | null = null;
  private predicted: Point[] = [];
  private hover: Point | null = null;
  private raf = 0;
  private dpr = 1;
  private color = '';
  private patterns: CanvasPattern[] = [];
  private patternColor = '';
  private fadeTimer = 0;
  private ro: ResizeObserver;

  constructor(private opts: PadOptions) {
    this.el = document.createElement('div');
    this.el.className = 'pad';
    this.ink = document.createElement('canvas');
    this.tip = document.createElement('canvas');
    this.el.append(this.ink, this.tip);
    this.ctx = this.ink.getContext('2d')!;
    this.tctx = this.tip.getContext('2d')!;

    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerup', this.up);
    this.el.addEventListener('pointercancel', this.up);
    // A lost pointerup must never leave the pad stuck "mid-stroke" (which would ignore all later ink):
    // also end the stroke on lost capture or a pointerup anywhere in the window.
    this.el.addEventListener('lostpointercapture', this.up);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    this.el.addEventListener('pointerleave', () => {
      this.hover = null;
      this.schedule();
    });
    // iOS: stop the loupe / scroll / double-tap zoom when touching the pad
    this.el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  destroy() {
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.fadeTimer);
  }

  private resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.ink, this.tip]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.patternColor = '';
    this.redraw();
  }

  private inkColor() {
    return this.color || getComputedStyle(this.el).getPropertyValue('--ink').trim() || '#2a2b30';
  }

  /** Build graphite grain patterns for the current ink colour. */
  private grain(): CanvasPattern[] {
    const color = this.inkColor();
    if (color === this.patternColor && this.patterns.length) return this.patterns;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    // one noise field shared by all densities, so heavier strokes fill in the gaps of lighter ones
    const noise = new Float32Array(GRAIN * GRAIN).map(() => Math.random());
    const shade = new Float32Array(GRAIN * GRAIN).map(() => (Math.random() - 0.5) * 36);
    this.patterns = DENSITY.map((d) => {
      const c = document.createElement('canvas');
      c.width = c.height = GRAIN;
      const x = c.getContext('2d')!;
      const img = x.createImageData(GRAIN, GRAIN);
      for (let i = 0; i < noise.length; i++) {
        if (noise[i] > d) continue;
        const o = i * 4;
        img.data[o] = r + shade[i];
        img.data[o + 1] = g + shade[i];
        img.data[o + 2] = b + shade[i];
        img.data[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      const pat = this.ctx.createPattern(c, 'repeat')!;
      // keep the grain at device-pixel size regardless of the dpr transform
      pat.setTransform(new DOMMatrix().scale(1 / this.dpr));
      return pat;
    });
    this.patternColor = color;
    return this.patterns;
  }

  private pt(e: PointerEvent, pen: boolean): Point {
    const r = this.el.getBoundingClientRect();
    let a = 0;
    if (pen) {
      const alt = (e as PointerEvent & { altitudeAngle?: number }).altitudeAngle;
      if (alt !== undefined) a = 1 - alt / (Math.PI / 2);
      else if (e.tiltX || e.tiltY) a = Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 90);
      // normal writing grip is ~30-40deg; only count real side-shading as tilt
      a = Math.max(0, (a - 0.45) / 0.55);
    }
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t: e.timeStamp,
      // mouse/touch report 0.5 or 0 pressure; only pen pressure is meaningful
      p: pen ? e.pressure || 0.5 : 0.55,
      a,
    };
  }

  private down = (e: PointerEvent) => {
    if (!this.opts.accept(e) || e.button > 0) return;
    if (this.active) {
      // A second touch while the Pencil is down is a resting palm: ignore it.
      // Anything else means we missed the previous pointerup: finish that stroke and start fresh.
      if (this.active.pen && e.pointerType === 'touch') return;
      if (e.pointerType === 'pen' && !this.active.pen) {
        // the Pencil arrived while a finger/palm was down: that touch was the palm, drop it
        this.active = null;
        this.redraw();
      } else this.end(this.active);
    }
    if (this.fadeTimer) this.finishFade();
    const pen = e.pointerType === 'pen';
    if (pen) this.opts.onPen?.();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    this.color = '';
    this.hover = null;
    this.active = { id: e.pointerId, stroke: [this.pt(e, pen)], drawn: 0, pen };
    this.opts.onStrokeStart?.();
    // Ink is drawn synchronously in the input handler, never deferred to rAF:
    // lowest latency, and the line still appears if frames are throttled.
    this.flush(this.active, false);
    this.schedule();
  };

  private move = (e: PointerEvent) => {
    const a = this.active;
    if (!a) {
      // Pencil hover (iPad Pro / M-series): show where the tip will land
      if (e.pointerType === 'pen' && e.buttons === 0 && this.opts.accept(e)) {
        this.hover = this.pt(e, true);
        this.schedule();
      }
      return;
    }
    if (e.pointerId !== a.id) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ce of evs.length ? evs : [e]) a.stroke.push(this.pt(ce, a.pen));
    this.flush(a, false);
    this.predicted = (e.getPredictedEvents?.() ?? []).map((pe) => this.pt(pe, a.pen));
    this.schedule();
  };

  private up = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    if (e.type === 'pointerup' && e.currentTarget === this.el) a.stroke.push(this.pt(e, a.pen));
    this.end(a);
  };

  private end(a: Active) {
    this.active = null;
    this.predicted = [];
    this.flush(a, true);
    this.drawTip();
    this.strokes.push(a.stroke);
    this.opts.onStrokeEnd?.(a.stroke);
  }

  private schedule() {
    this.raf ||= requestAnimationFrame(() => {
      this.raf = 0;
      this.drawTip();
    });
  }

  private base() {
    return Math.max(2.4, Math.min(this.el.clientHeight, 640) / 95);
  }

  private width(p: Point) {
    return this.base() * (0.5 + 0.85 * p.p) * (1 + 2.2 * (p.a ?? 0));
  }

  private density(p: Point) {
    const v = p.p * 1.25 - (p.a ?? 0) * 0.9;
    return Math.max(0, Math.min(DENSITY.length - 1, Math.round(v * (DENSITY.length - 1))));
  }

  /**
   * Draw the not-yet-drawn part of a stroke as midpoint-smoothed quadratic segments.
   * With `done`, finish the tail up to the last point.
   */
  private flush(a: { stroke: Stroke; drawn: number }, done: boolean, c = this.ctx) {
    const s = a.stroke;
    if (!s.length) return;
    const pats = this.grain();
    c.save();
    c.scale(this.dpr, this.dpr);
    c.lineCap = c.lineJoin = 'round';
    const mid = (i: number) => ({ x: (s[i].x + s[i + 1].x) / 2, y: (s[i].y + s[i + 1].y) / 2 });
    if (a.drawn === 0) {
      // the dot where the pencil lands
      const w = this.width(s[0]);
      c.fillStyle = pats[this.density(s[0])];
      c.beginPath();
      c.arc(s[0].x, s[0].y, w / 2, 0, Math.PI * 2);
      c.fill();
      a.drawn = 1;
    }
    for (let i = Math.max(1, a.drawn); i < s.length; i++) {
      c.strokeStyle = pats[this.density(s[i])];
      c.lineWidth = this.width(s[i]);
      c.beginPath();
      if (i === 1) {
        const m = s.length > 1 ? mid(0) : s[0];
        c.moveTo(s[0].x, s[0].y);
        c.lineTo(m.x, m.y);
      } else {
        const m0 = mid(i - 2), m1 = mid(i - 1);
        c.moveTo(m0.x, m0.y);
        c.quadraticCurveTo(s[i - 1].x, s[i - 1].y, m1.x, m1.y);
      }
      c.stroke();
    }
    a.drawn = s.length;
    if (done && s.length > 1) {
      const n = s.length - 1;
      const m = mid(n - 1);
      c.strokeStyle = pats[this.density(s[n])];
      c.lineWidth = this.width(s[n]);
      c.beginPath();
      c.moveTo(m.x, m.y);
      c.lineTo(s[n].x, s[n].y);
      c.stroke();
    }
    c.restore();
  }

  private drawTip() {
    const c = this.tctx;
    c.clearRect(0, 0, this.tip.width, this.tip.height);
    const a = this.active;
    c.save();
    c.scale(this.dpr, this.dpr);
    if (a && this.predicted.length) {
      // predicted continuation: faint, replaced by real ink next frame
      const last = a.stroke[a.stroke.length - 1];
      c.lineCap = c.lineJoin = 'round';
      c.strokeStyle = this.grain()[1];
      c.globalAlpha = 0.6;
      c.lineWidth = this.width(last);
      c.beginPath();
      c.moveTo(last.x, last.y);
      for (const p of this.predicted) c.lineTo(p.x, p.y);
      c.stroke();
    } else if (!a && this.hover) {
      c.fillStyle = this.inkColor();
      c.globalAlpha = 0.28;
      c.beginPath();
      c.arc(this.hover.x, this.hover.y, Math.max(3, this.base() * 0.8), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    for (const s of this.strokes) this.flush({ stroke: s, drawn: 0 }, true);
  }

  /** Recolour current ink (e.g. red for a wrong answer). */
  tint(color: string) {
    this.color = color.trim();
    this.redraw();
  }

  /** Clear the pad. With `fade`, the ink stays visible briefly and fades out. */
  clear(fade = false) {
    this.strokes = [];
    if (fade) {
      clearTimeout(this.fadeTimer);
      this.ink.style.transition = 'opacity 0.22s ease-out';
      this.ink.style.opacity = '0';
      this.fadeTimer = window.setTimeout(() => this.finishFade(), 230);
      return;
    }
    this.finishFade();
  }

  private finishFade() {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = 0;
    this.ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    this.ink.style.transition = 'none';
    this.ink.style.opacity = '1';
    this.color = '';
  }

  get busy() {
    return this.active !== null;
  }
}
