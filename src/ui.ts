type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string };

/** Minimal element factory: h('button.primary', { onclick }, 'Go') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [name, ...cls] = tag.split('.');
  const [base, id] = name.split('#');
  const el = document.createElement(base as K);
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const nav = (hash: string) => {
  location.hash = hash;
};

export function fmtTime(ms: number, precise = true): string {
  if (!Number.isFinite(ms)) return '—';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const sec = precise ? rest.toFixed(1) : String(Math.floor(rest));
  return m ? `${m}:${sec.padStart(precise ? 4 : 2, '0')}` : sec;
}

export function starsEl(n: number, max = 3, cls = '') {
  return h(
    'span.stars',
    { class: cls, 'aria-label': `${n} of ${max} stars` },
    ...Array.from({ length: max }, (_, i) => h('span.star', { class: i < n ? 'on' : '' }, '★')),
  );
}

export const icon = {
  back: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  erase: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 16l9-9 6 6-7 7H7zM12 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l7 6-7 6zM16 6v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

export function iconBtn(svg: string, label: string, onclick: () => void, cls = '') {
  const b = h('button.icon-btn', { 'aria-label': label, title: label, onclick, class: cls });
  b.innerHTML = svg;
  return b;
}

export function topbar(title: string, back: string | (() => void), ...right: Node[]) {
  return h(
    'header.topbar',
    null,
    iconBtn(icon.back, 'Back', () => (typeof back === 'string' ? nav(back) : back())),
    h('h1', null, title),
    h('div.topbar-right', null, ...right),
  );
}

/** DocumentFragment from children, skipping falsy ones (for conditional sections). */
export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const c of children) if (c !== null && c !== undefined && c !== false) f.append(c instanceof Node ? c : String(c));
  return f;
}
