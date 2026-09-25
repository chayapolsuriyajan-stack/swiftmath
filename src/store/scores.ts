import type { CategoryId } from '../game/levels';
import { profile, state } from '../state';
import { db } from './db';

export interface Run {
  ms: number;
  mistakes: number;
  at: number;
}

export interface Progress {
  key: string;
  profile: string;
  cat: CategoryId;
  lvl: number;
  bestMs: number;
  bestMistakes: number;
  bestAt?: number;
  stars: number;
  plays: number;
  runs: Run[];
}

export const pkey = (profileId: string, cat: string, lvl: number) => `${profileId}:${cat}:${lvl}`;

export async function progressFor(profileId: string): Promise<Map<string, Progress>> {
  const rows = await db.byProfile<Progress>('progress', profileId);
  return new Map(rows.map(({ value }) => [`${value.cat}:${value.lvl}`, value]));
}

/** Record a finished run. Returns previous best (if any) and the updated record. */
export async function recordRun(cat: CategoryId, lvl: number, run: Run, stars: number) {
  const id = state.settings.profileId!;
  const key = pkey(id, cat, lvl);
  const prev = await db.get<Progress>('progress', key);
  const next: Progress = prev
    ? { ...prev, runs: [run, ...prev.runs].slice(0, 10), plays: prev.plays + 1 }
    : { key, profile: id, cat, lvl, bestMs: Infinity, bestMistakes: Infinity, stars: 0, plays: 1, runs: [run] };
  const isBest = run.ms < next.bestMs;
  if (isBest) {
    next.bestMs = run.ms;
    next.bestMistakes = run.mistakes;
    next.bestAt = run.at;
  }
  next.stars = Math.max(next.stars, stars);
  await db.put('progress', next);
  return { prev, next, isBest };
}

// ---- local highscores (all players on this device) ----

export interface LocalEntry {
  rank: number;
  name: string;
  profile: string;
  ms: number;
  mistakes: number;
  at: number;
}

/** Fastest runs for a level across every player on this device. */
export async function localBoard(cat: CategoryId, lvl: number, limit = 20): Promise<LocalEntry[]> {
  const names = new Map(state.profiles.map((p) => [p.id, p.name]));
  const rows = (await db.all<Progress>('progress')).filter((r) => r.cat === cat && r.lvl === lvl && names.has(r.profile));
  const runs: Omit<LocalEntry, 'rank'>[] = [];
  for (const r of rows) {
    const seen = new Set<number>();
    const all = r.bestAt ? [{ ms: r.bestMs, mistakes: r.bestMistakes, at: r.bestAt }, ...r.runs] : r.runs;
    for (const run of all) {
      if (seen.has(run.at)) continue;
      seen.add(run.at);
      runs.push({ ...run, profile: r.profile, name: names.get(r.profile)! });
    }
  }
  runs.sort((a, b) => a.ms - b.ms || a.mistakes - b.mistakes || a.at - b.at);
  return runs.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Rank of a run among all runs of that level on this device (1-based). */
export async function localRank(cat: CategoryId, lvl: number, at: number): Promise<number | null> {
  const board = await localBoard(cat, lvl, 1000);
  return board.find((e) => e.at === at)?.rank ?? null;
}

/** Total best stars per player on this device. */
export async function localStars(): Promise<{ rank: number; name: string; profile: string; stars: number; levels: number }[]> {
  const rows = await db.all<Progress>('progress');
  const out = state.profiles.map((p) => {
    const mine = rows.filter((r) => r.profile === p.id);
    return { name: p.name, profile: p.id, stars: mine.reduce((a, r) => a + r.stars, 0), levels: mine.length, rank: 0 };
  });
  out.sort((a, b) => b.stars - a.stars || b.levels - a.levels);
  out.forEach((e, i) => (e.rank = i > 0 && out[i - 1].stars === e.stars ? out[i - 1].rank : i + 1));
  return out;
}

// ---- online leaderboard (off for now: needs a Redis store on Vercel, see api/) ----

export const ONLINE = false;

export interface ScoreSubmission {
  deviceId: string;
  nickname: string;
  cat: CategoryId;
  lvl: number;
  timeMs: number;
  mistakes: number;
  questions: number;
  stars: number;
}

export interface BoardEntry {
  rank: number;
  nickname: string;
  score: number;
  timeMs?: number;
  mistakes?: number;
  me?: boolean;
}

export interface Board {
  top: BoardEntry[];
  me: BoardEntry | null;
}

export async function submitScore(s: Omit<ScoreSubmission, 'deviceId' | 'nickname'>): Promise<{ rank: number } | null> {
  if (!ONLINE) return null;
  const body: ScoreSubmission = { ...s, deviceId: `${state.settings.deviceId}:${state.settings.profileId}`, nickname: profile()!.name };
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
    if (res.status >= 500) throw new Error('server');
    return null; // rejected (validation / rate limit): don't retry
  } catch {
    await db.put('queue', body);
    return null;
  }
}

export async function flushQueue() {
  if (!ONLINE || !navigator.onLine) return;
  const keys = await db.allKeys('queue');
  for (const k of keys) {
    const body = await db.get<ScoreSubmission>('queue', k);
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status >= 500) return;
      await db.del('queue', k);
    } catch {
      return;
    }
  }
}

export async function fetchBoard(cat: CategoryId | 'global', lvl?: number): Promise<Board | null> {
  const q = new URLSearchParams({ cat, id: `${state.settings.deviceId}:${state.settings.profileId}` });
  if (lvl !== undefined) q.set('lvl', String(lvl));
  try {
    const res = await fetch(`/api/leaderboard?${q}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
