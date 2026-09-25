import type { Point, Stroke } from './stroke';

export interface PadOptions {
  /** decide whether a pointer type may draw (palm rejection) */
  accept: (e: PointerEvent) => boolean;
  onPen?: () => void;
  onStrokeStart?: () => void;
  onStrokeEnd?: (s: Stroke) => void;
}

/**
 * Low-latency ink surface: coalesced events for full Pencil sample rate,
 * predicted events drawn on an overlay, incremental rendering in rAF.
 */
export class InkPad {
  readonly el: HTMLDivElement;
  strokes: Stroke[] = [];
  private ink: HTMLCanvasElement;
  private tip: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tctx: CanvasRenderingContext2D;
  private active: { id: number; stroke: Stroke; drawn: number; pen: boolean } | null = null;
  private predicted: Point[] = [];
  private raf = 0;
  private dpr = 1;
  private color = '';
  private ro: ResizeObserver;

  constructor(private opts: PadOptions) {
    this.el = document.createElement('div');
    this.el.className = 'pad';
    this.ink = document.createElement('canvas');
    this.tip = document.createElement('canvas');
    this.el.append(this.ink, this.tip);
    const ctxOpts = { desynchronized: true, alpha: true } as CanvasRenderingContext2DSettings;
    this.ctx = this.ink.getContext('2d', ctxOpts)!;
    this.tctx = this.tip.getContext('2d', ctxOpts)!;

    this.el.addEventListener('pointerdown', this.down);
    this.el.addEventListener('pointermove', this.move);
    this.el.addEventListener('pointerup', this.up);
    this.el.addEventListener('pointercancel', this.up);
    // iOS: stop the loupe / scroll / double-tap zoom when touching the pad
    this.el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  private resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.ink, this.tip]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.redraw();
  }

  private inkColor() {
    return this.color || getComputedStyle(this.el).getPropertyValue('--ink').trim() || '#111';
  }

  private pt(e: PointerEvent, pen: boolean): Point {
    const r = this.el.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t: e.timeStamp,
      // mouse/touch report 0.5 or 0 pressure; only pen pressure is meaningful
      p: pen ? e.pressure || 0.5 : 0.5,
    };
  }

  private down = (e: PointerEvent) => {
    if (this.active || !this.opts.accept(e)) return;
    if (e.button > 0) return;
    const pen = e.pointerType === 'pen';
    if (pen) this.opts.onPen?.();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    this.color = '';
    this.active = { id: e.pointerId, stroke: [this.pt(e, pen)], drawn: 0, pen };
    this.opts.onStrokeStart?.();
    this.schedule();
  };

  private move = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ce of evs.length ? evs : [e]) a.stroke.push(this.pt(ce, a.pen));
    this.predicted = (e.getPredictedEvents?.() ?? []).map((pe) => this.pt(pe, a.pen));
    this.schedule();
  };

  private up = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    if (e.type === 'pointerup') a.stroke.push(this.pt(e, a.pen));
    this.active = null;
    this.predicted = [];
    this.flush(a);
    this.tctx.clearRect(0, 0, this.tip.width, this.tip.height);
    this.strokes.push(a.stroke);
    this.opts.onStrokeEnd?.(a.stroke);
  };

  private schedule() {
    this.raf ||= requestAnimationFrame(() => {
      this.raf = 0;
      if (this.active) this.flush(this.active);
      this.drawTip();
    });
  }

  private width(p: Point) {
    const base = Math.max(3, Math.min(this.el.clientHeight, 600) / 70);
    return base * (0.55 + 0.9 * p.p);
  }

  /** draw only segments not yet on the canvas */
  private flush(a: { stroke: Stroke; drawn: number }) {
    const s = a.stroke;
    const c = this.ctx;
    c.save();
    c.scale(this.dpr, this.dpr);
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = c.fillStyle = this.inkColor();
    if (a.drawn === 0 && s.length) {
      c.beginPath();
      c.arc(s[0].x, s[0].y, this.width(s[0]) / 2, 0, Math.PI * 2);
      c.fill();
      a.drawn = 1;
    }
    for (let i = Math.max(1, a.drawn); i < s.length; i++) {
      c.beginPath();
      c.lineWidth = this.width(s[i]);
      c.moveTo(s[i - 1].x, s[i - 1].y);
      c.lineTo(s[i].x, s[i].y);
      c.stroke();
    }
    a.drawn = s.length;
    c.restore();
  }

  private drawTip() {
    const c = this.tctx;
    c.clearRect(0, 0, this.tip.width, this.tip.height);
    const a = this.active;
    if (!a || !this.predicted.length) return;
    c.save();
    c.scale(this.dpr, this.dpr);
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = this.inkColor();
    c.globalAlpha = 0.55;
    c.lineWidth = this.width(a.stroke[a.stroke.length - 1]);
    c.beginPath();
    const last = a.stroke[a.stroke.length - 1];
    c.moveTo(last.x, last.y);
    for (const p of this.predicted) c.lineTo(p.x, p.y);
    c.stroke();
    c.restore();
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.ink.width, this.ink.height);
    for (const s of this.strokes) this.flush({ stroke: s, drawn: 0 });
  }

  /** Recolour current ink (e.g. red for a wrong answer). */
  tint(color: string) {
    this.color = color;
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.color = '';
    this.ctx.clearRect(0, 0, this.ink.width, this.ink.height);
  }

  get busy() {
    return this.active !== null;
  }
}
