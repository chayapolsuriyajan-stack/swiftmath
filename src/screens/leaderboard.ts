import { CATEGORIES, type CategoryId } from '../game/levels';
import { fetchBoard, type Board, type BoardEntry } from '../store/scores';
import { fmtTime, h, topbar } from '../ui';

export function boardScreen(root: HTMLElement, [catArg, lvlArg]: string[]) {
  let cat: CategoryId | 'global' = (catArg as CategoryId) || 'global';
  let lvl = Number(lvlArg) || 0;
  let seq = 0;

  const catSel = h(
    'select.select',
    {
      'aria-label': 'Category',
      onchange: () => {
        cat = catSel.value as CategoryId | 'global';
        load();
      },
    },
    h('option', { value: 'global' }, 'All stars'),
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

  root.append(topbar('Leaderboard', '#/'), h('div.board-controls', null, catSel, lvlSel), list);

  async function load() {
    lvlSel.hidden = cat === 'global';
    const my = ++seq;
    list.replaceChildren(h('div.empty', null, 'Loading…'));
    const board = await fetchBoard(cat, cat === 'global' ? undefined : lvl);
    if (my === seq) render(board);
  }

  function render(b: Board | null) {
    if (!b) return list.replaceChildren(h('div.empty', null, navigator.onLine ? 'Leaderboard unavailable right now.' : 'You are offline.'));
    if (!b.top.length) return list.replaceChildren(h('div.empty', null, 'No scores yet. Be the first!'));
    const rows: Node[] = b.top.map(row);
    if (b.me && !b.top.some((e) => e.me)) rows.push(h('div.muted', { style: { textAlign: 'center' } }, '⋯'), row(b.me));
    list.replaceChildren(...rows);
  }

  function row(e: BoardEntry) {
    return h(
      'div.row',
      { class: e.me ? 'me' : '' },
      h('span.rank', { class: e.rank === 1 ? 'r1' : '' }, e.rank),
      h(
        'div.grow',
        null,
        h('div', { style: { fontWeight: '600' } }, e.nickname),
        cat !== 'global' && e.mistakes ? h('div.sub', null, `${e.mistakes} mistake${e.mistakes > 1 ? 's' : ''}`) : null,
      ),
      h('b.tabular', null, cat === 'global' ? `${e.score} ★` : fmtTime(e.timeMs ?? e.score)),
    );
  }

  load();
}
