import { CATEGORIES, type CategoryId } from '../game/levels';
import { state } from '../state';
import { localBoard, localStars } from '../store/scores';
import { fmtTime, h, topbar } from '../ui';

/** High scores for everyone who plays on this device. */
export function boardScreen(root: HTMLElement, [catArg, lvlArg]: string[]) {
  let cat: CategoryId | 'stars' = (CATEGORIES.some((c) => c.id === catArg) ? catArg : 'stars') as CategoryId | 'stars';
  let lvl = Number(lvlArg) || 0;
  let seq = 0;

  const catSel = h(
    'select.select',
    {
      'aria-label': 'Category',
      onchange: () => {
        cat = catSel.value as CategoryId | 'stars';
        load();
      },
    },
    h('option', { value: 'stars' }, 'Total stars'),
    ...CATEGORIES.map((c) => h('option', { value: c.id }, c.name)),
  );
  const lvlSel = h(
    'select.select',
    {
      'aria-label': 'Level',
      onchange: () => {
        lvl = +lvlSel.value;
        load();
      },
    },
    ...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i) }, `Level ${i + 1}`)),
  );
  catSel.value = cat;
  lvlSel.value = String(lvl);
  const list = h('div.list');

  root.append(
    topbar('High scores', '#/'),
    h('div.board-controls', null, catSel, lvlSel),
    list,
    h('p.muted', { style: { fontSize: '13px', textAlign: 'center', marginTop: '24px' } }, 'Scores are kept on this device.'),
  );

  async function load() {
    lvlSel.hidden = cat === 'stars';
    const my = ++seq;
    const me = state.settings.profileId;
    if (cat === 'stars') {
      const rows = await localStars();
      if (my !== seq) return;
      if (!rows.some((r) => r.stars)) return empty();
      list.replaceChildren(
        ...rows.map((r) =>
          row(r.rank, r.name, `${r.levels} level${r.levels === 1 ? '' : 's'} played`, `${r.stars} ★`, r.profile === me),
        ),
      );
      return;
    }
    const rows = await localBoard(cat, lvl);
    if (my !== seq) return;
    if (!rows.length) return empty();
    const fmtDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    list.replaceChildren(
      ...rows.map((r) =>
        row(
          r.rank,
          r.name,
          `${r.mistakes ? `${r.mistakes} mistake${r.mistakes > 1 ? 's' : ''} · ` : ''}${fmtDate.format(r.at)}`,
          fmtTime(r.ms),
          r.profile === me,
        ),
      ),
    );
  }

  const empty = () => list.replaceChildren(h('div.empty', null, 'No scores yet. Play a level to set one!'));

  function row(rank: number, name: string, sub: string, value: string, mine: boolean) {
    return h(
      'div.row',
      { class: mine ? 'me' : '' },
      h('span.rank', { class: rank === 1 ? 'r1' : '' }, rank),
      h('div.grow', null, h('div', { style: { fontWeight: '600' } }, name), h('div.sub', null, sub)),
      h('b.tabular', null, value),
    );
  }

  load();
}
