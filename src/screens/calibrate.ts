import type { Stroke } from '../ink/stroke';
import type { Recognizer } from '../recognizer';
import { segment } from '../recognizer/segment';
import { persistSamples, profile, recognizer, resetSamples, saveProfiles } from '../state';
import { h, nav, topbar } from '../ui';
import { createWriter } from './writer';

const REPEATS = 3;
const NUMBERS = 5;
const OVERLAPS = [0.25, 0.35, 0.45, 0.55, 0.65];

interface NumberSample {
  target: string;
  strokes: Stroke[];
}

export function calibrateScreen(root: HTMLElement) {
  const prof = profile()!;
  let alive = true;
  let cleanupWriter: (() => void) | null = null;

  intro();

  function intro() {
    root.replaceChildren(
      topbar('Handwriting', '#/'),
      h(
        'div.calib-intro',
        null,
        h('h2', null, prof.calibrated ? 'Recalibrate your handwriting' : 'Teach SwiftMath your handwriting'),
        h(
          'p',
          null,
          `Write each digit the way you naturally do — like your signature. It takes about a minute: ${10 * REPEATS} single digits, then ${NUMBERS} short numbers so it learns your spacing and rhythm. It keeps learning from every correct answer after this.`,
        ),
        h('button.btn.primary', { onclick: () => digitsPhase(shuffle(allDigits())) }, 'Start'),
        prof.calibrated &&
          h(
            'div',
            { style: { marginTop: '14px' } },
            h(
              'button.btn.small.danger',
              {
                onclick: async () => {
                  await resetSamples();
                  prof.calibrated = false;
                  prof.digitSkill = Array(10).fill(0.5);
                  await saveProfiles();
                  toast('Handwriting samples cleared');
                  intro();
                },
              },
              'Forget my handwriting',
            ),
          ),
      ),
    );
  }

  // ---------- phase 1: single digits ----------
  async function digitsPhase(queue: number[], practice = false) {
    const results: boolean[][] = Array.from({ length: 10 }, () => []);
    const rec = await recognizer();
    if (!alive) return;
    let i = 0;
    const label = h('div.label');
    const target = h('div.target');
    const status = h('div.reading');
    const fill = h('i', { style: { width: '0%' } });

    const writer = createWriter({
      pauseMs: () => 650,
      onPause: (strokes, final) => {
        if (final || !strokes.length) return;
        const d = queue[i];
        // The label is known, so treat everything on the pad as one digit.
        const read = rec.readDigit(strokes);
        results[d].push(read.digit === d);
        const { added, evicted } = rec.learnDigit(read, d, 'calib');
        persistSamples(added, evicted);
        status.replaceChildren(
          read.digit === d ? h('span.chip.good', null, `✓ read ${d}`) : h('span.chip.warn', null, `read ${read.digit} · learned your ${d}`),
        );
        writer.clear();
        i++;
        if (i >= queue.length) return setTimeout(() => alive && (practice ? practiceDone(results) : numbersPhase(rec, results)), 350);
        show();
      },
    });
    cleanupWriter = writer.destroy;

    function show() {
      label.textContent = `Write this digit · ${i + 1} of ${queue.length}`;
      target.textContent = String(queue[i]);
      fill.style.width = `${(i / queue.length) * 100}%`;
    }

    root.replaceChildren(
      topbar('Calibration', () => nav('#/'), h('div.bar', { style: { width: '120px', alignSelf: 'center' } }, fill)),
      h('div.calib-prompt', null, label, target, status),
      writer.el,
    );
    root.className = 'screen screen-calibrate';
    show();
  }

  // ---------- phase 2: numbers (spacing + rhythm) ----------
  function numbersPhase(rec: Recognizer, results: boolean[][]) {
    cleanupWriter?.();
    const targets = Array.from({ length: NUMBERS }, (_, k) => randomNumber(k < 3 ? 2 : 3));
    const samples: NumberSample[] = [];
    let i = 0;
    const label = h('div.label');
    const target = h('div.target');
    const status = h('div.reading');

    const writer = createWriter({
      pauseMs: () => 1000,
      onPause: (strokes, final) => {
        if (final || !strokes.length) return;
        const t = targets[i];
        samples.push({ target: t, strokes: [...strokes] });
        const r = rec.read(strokes);
        status.replaceChildren(r.text === t ? h('span.chip.good', null, `✓ read ${t}`) : h('span.chip.warn', null, `read ${r.text || '—'}`));
        writer.clear();
        if (++i >= targets.length) return finishCalibration(rec, results, samples);
        show();
      },
    });
    cleanupWriter = writer.destroy;

    function show() {
      label.textContent = `Now write this number · ${i + 1} of ${targets.length}`;
      target.textContent = targets[i];
    }

    root.replaceChildren(topbar('Calibration', () => nav('#/')), h('div.calib-prompt', null, label, target, status), writer.el);
    show();
  }

  async function finishCalibration(rec: Recognizer, results: boolean[][], samples: NumberSample[]) {
    cleanupWriter?.();
    // pick the merge threshold that splits the user's numbers into the right number of digits
    let bestOv = prof.seg.mergeOverlap, bestScore = -1;
    for (const ov of OVERLAPS) {
      const score = samples.filter((s) => segment(s.strokes, { mergeOverlap: ov }).length === s.target.length).length;
      // prefer the current/default value on ties (closest to 0.45)
      if (score > bestScore || (score === bestScore && Math.abs(ov - 0.45) < Math.abs(bestOv - 0.45))) {
        bestScore = score;
        bestOv = ov;
      }
    }
    prof.seg = { mergeOverlap: bestOv };
    rec.seg = { ...prof.seg };

    // learn digits from correctly-segmented numbers
    for (const s of samples) {
      const r = rec.read(s.strokes);
      const { added, evicted } = rec.learn(r, s.target, 'calib');
      await persistSamples(added, evicted);
    }

    // auto-check pause: slowest typical gap between strokes within a number, plus margin
    const gaps: number[] = [];
    for (const s of samples)
      for (let k = 1; k < s.strokes.length; k++) {
        const a = s.strokes[k - 1], b = s.strokes[k];
        gaps.push(b[0].t - a[a.length - 1].t);
      }
    gaps.sort((a, b) => a - b);
    const p90 = gaps.length ? gaps[Math.floor(gaps.length * 0.9)] : 300;
    prof.pauseMs = Math.round(Math.max(350, Math.min(900, p90 + 180)));

    // accuracy: re-read what we learned vs. first read
    const skill = results.map((r) => (r.length ? r.filter(Boolean).length / r.length : 0.5));
    prof.digitSkill = skill;
    prof.calibrated = true;
    await saveProfiles();
    if (alive) summary(skill);
  }

  async function practiceDone(results: boolean[][]) {
    cleanupWriter?.();
    const skill = prof.digitSkill.map((old, d) => (results[d].length ? results[d].filter(Boolean).length / results[d].length : old));
    prof.digitSkill = skill;
    await saveProfiles();
    if (alive) summary(skill);
  }

  function summary(skill: number[]) {
    const weak = skill.map((s, d) => ({ s, d })).filter((x) => x.s < 0.67).map((x) => x.d);
    root.replaceChildren(
      topbar('Calibration', '#/'),
      h(
        'div.calib-intro',
        { style: { marginTop: '3vh' } },
        h('h2', null, 'All set'),
        h(
          'p',
          null,
          weak.length
            ? 'The base model misread a few of your digits at first. They are now learned from your samples. Practise them again to reinforce.'
            : 'Your handwriting reads cleanly. SwiftMath keeps learning as you play.',
        ),
        h(
          'div.digit-grid',
          null,
          ...skill.map((s, d) =>
            h('div.digit-cell', { class: s < 0.67 ? 'weak' : '' }, h('b', null, d), h('span', null, `${Math.round(s * 100)}%`)),
          ),
        ),
        h('div.muted', { style: { fontSize: '14px', marginBottom: '22px' } }, `Answer check after ${profile()!.pauseMs} ms pause`),
        h(
          'div.sheet-actions',
          null,
          weak.length > 0 &&
            h('button.btn', { onclick: () => digitsPhase(shuffle(weak.flatMap((d) => [d, d, d])), true) }, 'Practise weak digits'),
          h('button.btn.primary', { onclick: () => nav('#/') }, 'Done'),
        ),
      ),
    );
  }

  return () => {
    alive = false;
    cleanupWriter?.();
  };
}

const allDigits = () => Array.from({ length: 10 * REPEATS }, (_, i) => i % 10);

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

function randomNumber(len: number) {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < len) s += Math.floor(Math.random() * 10);
  return s;
}

export function toast(text: string) {
  const t = h('div.toast', null, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}
