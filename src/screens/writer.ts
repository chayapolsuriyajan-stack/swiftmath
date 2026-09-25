import { InkPad } from '../ink/pad';
import { bbox, type Stroke } from '../ink/stroke';
import { isScratchOut } from '../recognizer/segment';
import { state } from '../state';
import { h, icon, iconBtn } from '../ui';

let penSeen = false;

export interface Writer {
  el: HTMLElement;
  pad: InkPad;
  /** clear the pad; `fade` lets the ink linger and fade out */
  clear: (fade?: boolean) => void;
  hint: (text: string) => void;
  destroy: () => void;
}

export interface WriterOpts {
  pauseMs: () => number;
  /** called after each stroke (live preview) */
  onStroke?: (strokes: Stroke[]) => void;
  /** short pause (final = false) then long pause (final = true) after the last stroke */
  onPause: (strokes: Stroke[], final: boolean) => void;
  onClear?: () => void;
  tools?: Node[];
}

export function createWriter(o: WriterOpts): Writer {
  let t1 = 0, t2 = 0;
  const cancel = () => {
    clearTimeout(t1);
    clearTimeout(t2);
  };
  const hintEl = h('div.pad-hint', null, 'Write here');

  const pad = new InkPad({
    accept: (e) => {
      const mode = state.settings.pencilOnly;
      if (e.pointerType !== 'touch') return true;
      return !(mode === 'on' || (mode === 'auto' && penSeen));
    },
    onPen: () => (penSeen = true),
    onStrokeStart: () => {
      cancel();
      hintEl.style.opacity = '0';
    },
    onStrokeEnd: (s) => {
      const others = pad.strokes.slice(0, -1);
      if (others.length) {
        const b = bbox(others);
        if (isScratchOut(s, b.maxY - b.minY)) return clear(true);
      }
      o.onStroke?.(pad.strokes);
      const ms = o.pauseMs();
      t1 = window.setTimeout(() => o.onPause(pad.strokes, false), ms);
      t2 = window.setTimeout(() => o.onPause(pad.strokes, true), ms * 3 + 200);
    },
  });

  function clear(fade = false) {
    cancel();
    pad.clear(fade);
    o.onClear?.();
  }

  const el = h(
    'div.pad-wrap',
    null,
    pad.el,
    hintEl,
    h('div.pad-tools', null, ...(o.tools ?? []), iconBtn(icon.erase, 'Clear', () => clear())),
  );

  return {
    el,
    pad,
    clear,
    hint: (text) => {
      hintEl.textContent = text;
      hintEl.style.opacity = text ? '1' : '0';
    },
    destroy: () => {
      cancel();
      pad.destroy();
    },
  };
}
