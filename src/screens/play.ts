import { draw, SLOT, type Problem } from '../game/generator';
import { category, MISTAKE_PENALTY_MS, QUESTIONS, stars as starsFor } from '../game/levels';
import type { Stroke } from '../ink/stroke';
import type { Reading, Recognizer } from '../recognizer';
import { persistSamples, profile, recognizer, saveProfiles, state } from '../state';
import { localRank, recordRun } from '../store/scores';
import { fmtTime, h, icon, iconBtn, nav, starsEl } from '../ui';
import { createWriter } from './writer';

/** readings below this top-2 margin are treated as "couldn't read", not as wrong answers */
const UNSURE = 0.25;

export function playScreen(root: HTMLElement, [catId, lvlStr]: string[]) {
  const cat = category(catId);
  const lvlIdx = Number(lvlStr);
  const level = cat?.levels[lvlIdx];
  if (!cat || !level) return nav('#/');
  root.style.setProperty('--c', `var(--c-${cat.id})`);
  const prof = profile()!;

  let rec: Recognizer | null = null;
  let phase: 'warmup' | 'countdown' | 'playing' | 'done' = 'countdown';
  let problems: Problem[] = [];
  let idx = 0;
  let mistakes = 0;
  let penalty = 0;
  let t0 = 0;
  let raf = 0;
  let locked = false; // ignore input while feedback animates
  let alive = true;

  // warm-up state
  let warm: string[] = [];
  let warmIdx = 0;

  const fill = h('i', { style: { width: '0%' } });
  const timer = h('div.timer.tabular', null, '0.0');
  const problemEl = h('div.problem');
  const nextEl = h('div.problem-next', { 'aria-hidden': 'true' });
  const reading = h('div.reading');
  const skipBtn = iconBtn(icon.skip, 'Skip', () => skip());

  const writer = createWriter({
    pauseMs: () => prof.pauseMs,
    onStroke: (s) => live(s),
    onPause: (s, final) => check(s, final),
    onClear: () => {
      reading.textContent = '';
      setSlot('', '');
    },
    tools: [skipBtn],
  });

  const countdown = h('div.countdown');
  root.append(
    h('div.play-top', null, iconBtn(icon.close, 'Quit', () => nav(`#/cat/${cat.id}`)), h('div.bar', null, fill), timer),
    h('div.problem-area', null, problemEl, nextEl, reading),
    writer.el,
  );

  // ---------- rendering ----------
  let slotEl: HTMLElement | null = null;
  const tokens = (p: Problem, live: boolean) =>
    p.parts.map((t) => {
      if (t === SLOT) {
        const el = h('span.slot', null, '?');
        if (live) slotEl = el;
        return el;
      }
      return h('span', { class: /^[+−×÷=]$/.test(t) ? 'op' : '' }, t);
    });

  /** current problem, plus a faint preview of the one after it */
  function renderProblem(p: Problem, upcoming?: Problem, advance = false) {
    slotEl = null;
    problemEl.replaceChildren(...tokens(p, true));
    nextEl.replaceChildren(...(upcoming ? tokens(upcoming, false) : []));
    for (const [el, cls] of [[problemEl, advance ? 'rise' : 'pop'], [nextEl, 'fade-in']] as const) {
      el.classList.remove('rise', 'pop', 'fade-in');
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }

  function setSlot(text: string, cls: '' | 'good' | 'bad') {
    if (!slotEl) return;
    slotEl.textContent = text || '?';
    slotEl.className = `slot ${cls}`;
  }

  function shake() {
    problemEl.classList.remove('shake');
    void problemEl.offsetWidth;
    problemEl.classList.add('shake');
  }

  function tick() {
    if (phase !== 'playing') return;
    const txt = fmtTime(performance.now() - t0 + penalty);
    if (timer.textContent !== txt) timer.textContent = txt;
    raf = requestAnimationFrame(tick);
  }

  // ---------- flow ----------
  async function start() {
    rec = await recognizer();
    if (!alive) return;
    const need = state.settings.warmup === 'always' || (state.settings.warmup === 'session' && !state.warmedUp);
    if (need) startWarmup();
    else startCountdown();
  }

  function startWarmup() {
    phase = 'warmup';
    // three short numbers built from the profile's weakest digits
    const order = prof.digitSkill.map((s, d) => ({ s: s + Math.random() * 0.15, d })).sort((a, b) => a.s - b.s).map((x) => x.d);
    const weak = order.slice(0, 6);
    warm = [0, 1, 2].map((i) => {
      let n = `${weak[i * 2]}${weak[i * 2 + 1]}`;
      if (n[0] === '0') n = n[1] + n[0];
      return n === '00' ? '10' : n;
    });
    warmIdx = 0;
    skipBtn.hidden = false;
    timer.textContent = 'Warm-up';
    showWarm();
  }

  function showWarm() {
    problemEl.replaceChildren(h('span.op', null, 'Write'), (slotEl = h('span.slot', null, warm[warmIdx])));
    reading.textContent = `Warm-up ${warmIdx + 1} of ${warm.length} · tap skip to start now`;
    fill.style.width = `${(warmIdx / warm.length) * 100}%`;
  }

  function startCountdown() {
    phase = 'countdown';
    state.warmedUp = true;
    writer.clear();
    problemEl.replaceChildren();
    nextEl.replaceChildren();
    reading.textContent = '';
    timer.textContent = '0.0';
    fill.style.width = '0%';
    writer.el.append(countdown);
    let n = 3;
    const step = () => {
      if (!alive) return;
      if (n === 0) {
        countdown.remove();
        return begin();
      }
      countdown.replaceChildren(h('span', null, n--));
      setTimeout(step, 450);
    };
    step();
  }

  function begin() {
    problems = draw(level!.make, QUESTIONS, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    idx = mistakes = penalty = 0;
    phase = 'playing';
    t0 = performance.now();
    renderProblem(problems[0], problems[1]);
    writer.hint('Write the answer');
    tick();
  }

  function next() {
    idx++;
    fill.style.width = `${(idx / QUESTIONS) * 100}%`;
    writer.clear(true);
    if (idx >= problems.length) {
      nextEl.replaceChildren();
      return finish();
    }
    renderProblem(problems[idx], problems[idx + 1], true);
  }

  // ---------- input ----------
  function live(strokes: Stroke[]) {
    if (!rec || phase === 'countdown' || phase === 'done') return;
    const r = rec.read(strokes);
    if (phase === 'playing') setSlot(r.text, '');
  }

  function check(strokes: Stroke[], final: boolean) {
    if (!rec || locked || !strokes.length) return;
    if (phase === 'warmup') return checkWarm(strokes, final);
    if (phase !== 'playing') return;
    const p = problems[idx];
    const ans = String(p.answer);
    const r = rec.read(strokes);
    if (r.text === ans) return correct(r, ans);
    if (!r.text || (r.text.length < ans.length && !final)) return;
    if (r.confidence < UNSURE) return unsure();
    wrong(r.text);
  }

  function correct(r: Reading, ans: string) {
    setSlot(ans, 'good');
    reading.textContent = '';
    // learn from confirmed answers; always when the read was shaky
    if (r.digits.some((d) => d.margin < 0.9) || Math.random() < 0.25) {
      const { added, evicted } = rec!.learn(r, ans, 'learned');
      persistSamples(added, evicted);
    }
    locked = true;
    setTimeout(() => {
      locked = false;
      if (alive) next();
    }, 160);
  }

  function wrong(text: string) {
    mistakes++;
    penalty += MISTAKE_PENALTY_MS;
    setSlot(text, 'bad');
    shake();
    writer.pad.tint(getComputedStyle(root).getPropertyValue('--bad'));
    timer.classList.add('penalty');
    locked = true;
    setTimeout(() => {
      locked = false;
      timer.classList.remove('penalty');
      if (!alive) return;
      writer.clear(true);
    }, 450);
  }

  function unsure() {
    reading.textContent = "Couldn't read that — try again";
    writer.pad.tint(getComputedStyle(root).getPropertyValue('--warn'));
    locked = true;
    setTimeout(() => {
      locked = false;
      if (alive) writer.clear(true);
      reading.textContent = '';
    }, 500);
  }

  function skip() {
    if (locked) return;
    if (phase === 'warmup') return startCountdown();
    if (phase !== 'playing') return;
    mistakes++;
    penalty += MISTAKE_PENALTY_MS;
    setSlot(String(problems[idx].answer), 'bad');
    locked = true;
    setTimeout(() => {
      locked = false;
      if (alive) next();
    }, 650);
  }

  function checkWarm(strokes: Stroke[], final: boolean) {
    const target = warm[warmIdx];
    const r = rec!.read(strokes);
    if (r.digits.length < target.length && !final) return;
    if (r.digits.length !== target.length) {
      reading.textContent = `Write ${target.split('').join(' ')} with a little space between digits`;
      writer.clear();
      return;
    }
    // The user was asked to write `target`, so the label is known: learn every digit.
    const { added, evicted } = rec!.learn(r, target, 'learned');
    persistSamples(added, evicted);
    r.digits.forEach((d, i) => {
      const t = +target[i];
      prof.digitSkill[t] = prof.digitSkill[t] * 0.7 + (d.digit === t ? 0.3 : 0);
    });
    saveProfiles();
    setSlot(target, r.text === target ? 'good' : '');
    reading.textContent = r.text === target ? 'Read perfectly' : `Read ${r.text} — learned your style`;
    locked = true;
    setTimeout(() => {
      locked = false;
      if (!alive) return;
      writer.clear();
      if (++warmIdx >= warm.length) startCountdown();
      else showWarm();
    }, 650);
  }

  // ---------- results ----------
  async function finish() {
    phase = 'done';
    cancelAnimationFrame(raf);
    const total = Math.round(performance.now() - t0 + penalty);
    timer.textContent = fmtTime(total);
    const st = starsFor(level!, total);
    const at = Date.now();
    const { prev, isBest } = await recordRun(cat!.id, lvlIdx, { ms: total, mistakes, at }, st);
    if (!alive) return;

    const rankEl = h('div.muted', { style: { fontSize: '14px', minHeight: '20px' } }, '');
    const hasNext = lvlIdx + 1 < cat!.levels.length;
    const sheet = h(
      'div.overlay',
      null,
      h(
        'div.sheet',
        null,
        h('h2', null, st === 3 ? 'Brilliant!' : st === 2 ? 'Great job!' : 'Level complete'),
        h('div.muted', null, `${cat!.name} · Level ${lvlIdx + 1}`),
        h('div.big-stars', null, starsEl(st)),
        isBest && prev ? h('div.new-best', null, 'New best time!') : null,
        h(
          'div.stats',
          null,
          h('div.stat', null, h('b', null, fmtTime(total)), h('span', null, 'Time')),
          h('div.stat', null, h('b', null, mistakes), h('span', null, 'Mistakes')),
          h('div.stat', null, h('b', null, fmtTime(Math.min(total, prev?.bestMs ?? Infinity))), h('span', null, 'Best')),
        ),
        rankEl,
        h(
          'div.sheet-actions',
          { style: { marginTop: '18px' } },
          h('button.btn', { onclick: () => nav(`#/cat/${cat!.id}`) }, 'Levels'),
          h('button.btn', { onclick: () => restart() }, 'Retry'),
          hasNext && h('button.btn.primary', { onclick: () => nav(`#/play/${cat!.id}/${lvlIdx + 1}`) }, 'Next'),
        ),
      ),
    );
    root.append(sheet);
    // stagger the stars in
    sheet.querySelectorAll<HTMLElement>('.big-stars .star').forEach((s, i) => {
      if (!s.classList.contains('on')) return;
      s.classList.remove('on');
      setTimeout(() => s.classList.add('on'), 150 + i * 160);
    });

    const rank = await localRank(cat!.id, lvlIdx, at);
    if (alive) rankEl.textContent = rank ? `#${rank} on this device · ${isBest ? 'personal best' : 'best ' + fmtTime(prev!.bestMs)}` : '';
  }

  function restart() {
    root.querySelector('.overlay')?.remove();
    startCountdown();
  }

  start();
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    writer.destroy();
  };
}
