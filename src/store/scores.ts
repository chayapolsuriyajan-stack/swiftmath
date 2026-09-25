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
  }
  next.stars = Math.max(next.stars, stars);
  await db.put('progress', next);
  return { prev, next, isBest };
}

// ---- online leaderboard ----

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
  if (!navigator.onLine) return;
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
