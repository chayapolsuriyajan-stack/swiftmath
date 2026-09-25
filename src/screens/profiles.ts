import { createProfile, deleteProfile, profile, selectProfile, state } from '../state';
import { frag, h, nav, topbar } from '../ui';

export function profilesScreen(root: HTMLElement) {
  const first = !state.profiles.length;
  const input = h('input.field', { placeholder: 'Name', maxLength: 16, autocomplete: 'off', enterkeyhint: 'done' });
  const add = async (e: Event) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    await createProfile(name);
    nav('#/calibrate');
  };

  const render = () => {
    const current = profile();
    root.replaceChildren(frag(
      first
        ? h(
            'div.calib-intro',
            { style: { marginTop: '10vh', marginBottom: '8px' } },
            h('h1.brand', null, 'Swift', h('span', null, 'Math')),
            h('p', null, 'Quick mental arithmetic. Write your answers by hand, with Apple Pencil or your finger.'),
          )
        : topbar('Players', '#/'),
      h('div.section-title', null, first ? 'Who is playing?' : 'Add player'),
      h('form.form-row', { onsubmit: add }, input, h('button.btn.primary', { type: 'submit' }, 'Add')),
      !first && h('div.section-title', null, 'Players'),
      !first &&
        h(
          'div.list',
          null,
          ...state.profiles.map((p) =>
            h(
              'div.row',
              { class: p.id === current?.id ? 'me' : '' },
              h('span.avatar', null, p.name[0]?.toUpperCase() ?? '?'),
              h(
                'button.grow',
                {
                  style: { textAlign: 'left' },
                  onclick: async () => {
                    await selectProfile(p.id);
                    nav('#/');
                  },
                },
                h('div', { style: { fontWeight: '600' } }, p.name),
                h('div.sub', null, p.calibrated ? 'Handwriting calibrated' : 'Not calibrated yet'),
              ),
              h(
                'button.btn.small.danger',
                {
                  onclick: async () => {
                    if (!confirm(`Delete ${p.name} and all their progress?`)) return;
                    await deleteProfile(p.id);
                    if (!state.profiles.length) {
                      nav('#/profiles');
                      location.reload();
                      return;
                    }
                    render();
                  },
                },
                'Delete',
              ),
            ),
          ),
        ),
    ));
    if (first) input.focus();
  };
  render();
}
