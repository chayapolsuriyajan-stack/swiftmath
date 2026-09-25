import { saveSettings, state, type Settings } from '../state';
import { h, nav, topbar } from '../ui';

function segmented<K extends 'pencilOnly' | 'warmup'>(key: K, options: [Settings[K], string][]) {
  const wrap = h('div.segmented');
  const render = () =>
    wrap.replaceChildren(
      ...options.map(([v, label]) =>
        h(
          'button',
          {
            class: state.settings[key] === v ? 'on' : '',
            onclick: () => {
              state.settings[key] = v;
              saveSettings();
              render();
            },
          },
          label,
        ),
      ),
    );
  render();
  return wrap;
}

const linkRow = (title: string, sub: string, hash: string) =>
  h(
    'button.row',
    { onclick: () => nav(hash), style: { textAlign: 'left', width: '100%' } },
    h('div.grow', null, h('div', null, title), sub && h('div.sub', null, sub)),
    h('span.muted', null, '›'),
  );

export function settingsScreen(root: HTMLElement) {
  root.append(
    topbar('Settings', '#/'),
    h('div.section-title', null, 'Input'),
    h(
      'div.list',
      null,
      h(
        'div.row',
        { style: { flexWrap: 'wrap' } },
        h('div.grow', null, h('div', null, 'Palm rejection'), h('div.sub', null, 'Ignore finger touches on the pad. Auto turns on once Apple Pencil is used.')),
        segmented('pencilOnly', [['auto', 'Auto'], ['on', 'Pencil only'], ['off', 'Off']]),
      ),
      h(
        'div.row',
        { style: { flexWrap: 'wrap' } },
        h('div.grow', null, h('div', null, 'Warm-up before levels'), h('div.sub', null, 'Three quick numbers that refresh your handwriting model.')),
        segmented('warmup', [['session', 'Once'], ['always', 'Always'], ['off', 'Off']]),
      ),
      linkRow('Handwriting calibration', 'Recalibrate or forget your handwriting samples.', '#/calibrate'),
    ),
    h('div.section-title', null, 'Players'),
    h('div.list', null, linkRow('Manage players', '', '#/profiles')),
    h('p.muted', { style: { fontSize: '13px', textAlign: 'center', marginTop: '32px' } }, 'Handwriting recognition runs entirely on this device.'),
  );
}
