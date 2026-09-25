import { CATEGORIES } from '../game/levels';
import { profile } from '../state';
import { progressFor } from '../store/scores';
import { frag, h, icon, nav } from '../ui';

export function homeScreen(root: HTMLElement) {
  const p = profile()!;
  const tiles = CATEGORIES.map((c) => {
    const meta = h('div.meta', null, h('span', null, '0 / 36 ★'), h('span', null, '0/12'));
    const fill = h('i', { style: { width: '0%' } });
    const tile = h(
      'button.cat',
      { onclick: () => nav(`#/cat/${c.id}`) },
      h('div.sym', { class: c.id === 'alg' ? 'var' : '' }, c.symbol),
      h('div.name', null, c.name),
      h('div.bar', null, fill),
      meta,
    );
    tile.style.setProperty('--c', `var(--c-${c.id})`);
    return { c, tile, meta, fill };
  });

  root.append(frag(
    h(
      'div.home-head',
      null,
      h('h1.brand', null, 'Swift', h('span', null, 'Math')),
      h(
        'button.profile-chip',
        { onclick: () => nav('#/profiles'), 'aria-label': 'Switch profile' },
        h('span.avatar', null, p.name[0]?.toUpperCase() ?? '?'),
        p.name,
      ),
    ),
    !p.calibrated &&
      h(
        'div.calib-banner',
        null,
        h('div.grow', null, h('b', null, 'Teach it your handwriting'), h('span.muted', null, 'A one-minute calibration makes answers read reliably.')),
        h('button.btn.small.primary', { onclick: () => nav('#/calibrate') }, 'Calibrate'),
      ),
    h('div.cats', null, ...tiles.map((t) => t.tile)),
    h(
      'div.home-actions',
      null,
      withIcon('button.btn.small', icon.trophy, 'High scores', () => nav('#/board')),
      withIcon('button.btn.small', icon.pen, 'Handwriting', () => nav('#/calibrate')),
      withIcon('button.btn.small', icon.gear, 'Settings', () => nav('#/settings')),
    ),
  ));

  progressFor(p.id).then((prog) => {
    for (const t of tiles) {
      let stars = 0, done = 0;
      for (let i = 0; i < t.c.levels.length; i++) {
        const r = prog.get(`${t.c.id}:${i}`);
        if (r) {
          stars += r.stars;
          done++;
        }
      }
      t.meta.replaceChildren(h('span', null, `${stars} / ${t.c.levels.length * 3} ★`), h('span', null, `${done}/${t.c.levels.length}`));
      t.fill.style.width = `${(done / t.c.levels.length) * 100}%`;
    }
  });
}

function withIcon(tag: 'button.btn.small', svg: string, label: string, onclick: () => void) {
  const b = h(tag, { onclick });
  b.innerHTML = svg;
  b.append(label);
  return b;
}

