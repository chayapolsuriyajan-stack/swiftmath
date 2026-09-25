import { category } from '../game/levels';
import { profile } from '../state';
import { progressFor } from '../store/scores';
import { fmtTime, h, icon, nav, starsEl, topbar } from '../ui';

export function levelsScreen(root: HTMLElement, [catId]: string[]) {
  const cat = category(catId);
  if (!cat) return nav('#/');
  root.style.setProperty('--c', `var(--c-${cat.id})`);
  const grid = h('div.levels');
  root.append(topbar(cat.name, '#/'), grid);

  progressFor(profile()!.id).then((prog) => {
    grid.replaceChildren(
      ...cat.levels.map((lvl, i) => {
        const r = prog.get(`${cat.id}:${i}`);
        const unlocked = i === 0 || prog.has(`${cat.id}:${i - 1}`);
        const el = h(
          'button.level',
          { class: unlocked ? '' : 'locked', disabled: !unlocked, onclick: () => nav(`#/play/${cat.id}/${i}`) },
          h('span.num', null, i + 1),
          h('span.lname', null, lvl.name),
          h('span.best', null, r ? starsEl(r.stars) : h('span'), h('span.tabular', null, r ? fmtTime(r.bestMs) : '')),
        );
        el.style.setProperty('--c', `var(--c-${cat.id})`);
        if (!unlocked) {
          const lock = h('span.best');
          lock.innerHTML = icon.lock;
          el.replaceChild(lock, el.lastChild!);
        }
        return el;
      }),
    );
  });
}
