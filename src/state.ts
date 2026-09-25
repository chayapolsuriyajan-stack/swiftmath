import { loadCnn } from './recognizer/cnn';
import { Recognizer } from './recognizer';
import { PersonalModel, type Sample } from './recognizer/personal';
import { DEFAULT_SEGMENT, type SegmentOpts } from './recognizer/segment';
import { db } from './store/db';

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  calibrated: boolean;
  seg: SegmentOpts;
  /** pause after last stroke before auto-check */
  pauseMs: number;
  /** per-digit calibration accuracy 0..1, used to pick warm-up digits */
  digitSkill: number[];
}

export interface Settings {
  deviceId: string;
  profileId: string | null;
  pencilOnly: 'auto' | 'on' | 'off';
  warmup: 'session' | 'always' | 'off';
  sound: boolean;
}

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

export const state = {
  settings: null as unknown as Settings,
  profiles: [] as Profile[],
  warmedUp: false,
  recognizer: null as Recognizer | null,
  recognizerFor: '',
};

export const profile = (): Profile | undefined => state.profiles.find((p) => p.id === state.settings.profileId);

export async function boot() {
  const s = await db.get<Settings>('kv', 'settings');
  state.settings = {
    deviceId: uid(),
    profileId: null,
    pencilOnly: 'auto',
    warmup: 'session',
    sound: false,
    ...s,
  };
  state.profiles = (await db.get<Profile[]>('kv', 'profiles')) ?? [];
  if (!profile()) state.settings.profileId = state.profiles[0]?.id ?? null;
  await saveSettings();
  loadCnn(); // warm the model cache in the background
}

export const saveSettings = () => db.put('kv', state.settings, 'settings');
export const saveProfiles = () => db.put('kv', state.profiles, 'profiles');

export async function createProfile(name: string): Promise<Profile> {
  const p: Profile = {
    id: uid(),
    name: name.trim().slice(0, 16) || 'Player',
    createdAt: Date.now(),
    calibrated: false,
    seg: { ...DEFAULT_SEGMENT },
    pauseMs: 420,
    digitSkill: Array(10).fill(0.5),
  };
  state.profiles.push(p);
  state.settings.profileId = p.id;
  state.warmedUp = false;
  await Promise.all([saveProfiles(), saveSettings()]);
  return p;
}

export async function selectProfile(id: string) {
  state.settings.profileId = id;
  state.warmedUp = false;
  await saveSettings();
}

export async function deleteProfile(id: string) {
  state.profiles = state.profiles.filter((p) => p.id !== id);
  for (const store of ['samples', 'progress'] as const)
    for (const { key } of await db.byProfile(store, id)) await db.del(store, key);
  if (state.settings.profileId === id) state.settings.profileId = state.profiles[0]?.id ?? null;
  if (state.recognizerFor === id) state.recognizerFor = '';
  await Promise.all([saveProfiles(), saveSettings()]);
}

type StoredSample = Sample & { profile: string };

/** Recognizer with the current profile's personal samples loaded. */
export async function recognizer(): Promise<Recognizer> {
  const p = profile()!;
  if (state.recognizer && state.recognizerFor === p.id) return state.recognizer;
  const [cnn, rows] = await Promise.all([loadCnn(), db.byProfile<StoredSample>('samples', p.id)]);
  const r = new Recognizer(cnn, new PersonalModel(rows.map((x) => x.value)));
  r.seg = { ...p.seg };
  state.recognizer = r;
  state.recognizerFor = p.id;
  return r;
}

/** Persist newly learned samples, dropping evicted ones. */
export async function persistSamples(added: Sample[], evicted: Sample[]) {
  const id = state.settings.profileId!;
  for (const s of added) await db.put('samples', { ...s, profile: id });
  if (!evicted.length) return;
  const rows = await db.byProfile<StoredSample>('samples', id);
  for (const e of evicted) {
    const row = rows.find((r) => r.value.ts === e.ts && r.value.label === e.label);
    if (row) await db.del('samples', row.key);
  }
}

export async function resetSamples() {
  const id = state.settings.profileId!;
  for (const { key } of await db.byProfile('samples', id)) await db.del('samples', key);
  state.recognizer?.personal.clear();
}
