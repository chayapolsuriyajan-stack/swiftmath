import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the handful of Upstash commands the API uses.
const fake = vi.hoisted(() => {
  const z = new Map<string, Map<string, number>>();
  const hs = new Map<string, Map<string, unknown>>();
  const kv = new Map<string, number>();
  const zset = (k: string) => (z.has(k) ? z.get(k)! : (z.set(k, new Map()), z.get(k)!));
  const hash = (k: string) => (hs.has(k) ? hs.get(k)! : (hs.set(k, new Map()), hs.get(k)!));
  const sorted = (k: string, rev = false) => [...zset(k)].sort((a, b) => (rev ? b[1] - a[1] : a[1] - b[1]) || a[0].localeCompare(b[0]));
  const redis = {
    async incr(k: string) { kv.set(k, (kv.get(k) ?? 0) + 1); return kv.get(k)!; },
    async expire() { return 1; },
    async zscore(k: string, m: string) { return zset(k).get(m) ?? null; },
    async zadd(k: string, { score, member }: { score: number; member: string }) { zset(k).set(member, score); return 1; },
    async zincrby(k: string, by: number, m: string) { const s = zset(k); s.set(m, (s.get(m) ?? 0) + by); return s.get(m); },
    async zrank(k: string, m: string) { const i = sorted(k).findIndex(([x]) => x === m); return i < 0 ? null : i; },
    async zrevrank(k: string, m: string) { const i = sorted(k, true).findIndex(([x]) => x === m); return i < 0 ? null : i; },
    async zrange(k: string, a: number, b: number, o: { rev?: boolean }) { return sorted(k, o.rev).slice(a, b + 1).flat(); },
    async hset(k: string, obj: Record<string, unknown>) { for (const [f, v] of Object.entries(obj)) hash(k).set(f, v); return 1; },
    async hget(k: string, f: string) { return hash(k).get(f) ?? null; },
    async hmget(k: string, ...fs: string[]) { return Object.fromEntries(fs.map((f) => [f, hash(k).get(f) ?? null])); },
    pipeline() {
      const ops: (() => Promise<unknown>)[] = [];
      const p = new Proxy({} as Record<string, unknown>, {
        get: (_t, name: string) =>
          name === 'exec'
            ? async () => { const out = []; for (const op of ops) out.push(await op()); return out; }
            : (...args: unknown[]) => { ops.push(() => (redis as never as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args)); return p; },
      });
      return p;
    },
    reset() { z.clear(); hs.clear(); kv.clear(); },
  };
  return redis;
});

vi.mock('../api/_redis', async (orig) => ({ ...(await orig<typeof import('../api/_redis')>()), redis: fake, unavailable: () => null }));

const { POST } = await import('../api/score');
const { GET } = await import('../api/leaderboard');

const submit = (body: Record<string, unknown>, ip = '1.1.1.1') =>
  POST(new Request('http://x/api/score', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } }));

const base = { deviceId: 'device-aaaa:p1', nickname: 'Ann', cat: 'add', lvl: 0, timeMs: 30000, mistakes: 0, questions: 20 };

describe('score API', () => {
  beforeEach(() => fake.reset());

  it('accepts a valid score and ranks it', async () => {
    const res = await submit(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rank: 1, improved: true, stars: 3 });
    const r2 = await submit({ ...base, deviceId: 'device-bbbb:p1', nickname: 'Bo', timeMs: 20000 });
    expect((await r2.json()).rank).toBe(1);
  });

  it('keeps only the best time per player', async () => {
    await submit(base);
    const worse = await (await submit({ ...base, timeMs: 50000 })).json();
    expect(worse.improved).toBe(false);
    const board = await (await GET(new Request('http://x/api/leaderboard?cat=add&lvl=0'))).json();
    expect(board.top).toHaveLength(1);
    expect(board.top[0]).toMatchObject({ nickname: 'Ann', timeMs: 30000, mistakes: 0 });
  });

  it('rejects implausible or malformed scores', async () => {
    expect((await submit({ ...base, timeMs: 3000 })).status).toBe(400);
    expect((await submit({ ...base, cat: 'nope' })).status).toBe(400);
    expect((await submit({ ...base, lvl: 12 })).status).toBe(400);
    expect((await submit({ ...base, deviceId: 'x' })).status).toBe(400);
    // penalty time does not count as solving time
    expect((await submit({ ...base, timeMs: 21000, mistakes: 10 })).status).toBe(400);
  });

  it('sanitises nicknames', async () => {
    await submit({ ...base, nickname: '<b>Evil</b>\u0000 name that is very long' });
    const board = await (await GET(new Request('http://x/api/leaderboard?cat=add&lvl=0'))).json();
    expect(board.top[0].nickname).toBe('bEvil/b name tha');
  });

  it('rate limits per IP', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await submit({ ...base, deviceId: `device-${i}xxxx` }, '9.9.9.9')).status;
    expect(last).toBe(429);
  });

  it('global board sums best stars and reports my rank', async () => {
    await submit(base); // 3 stars
    await submit({ ...base, lvl: 1 }); // 3 stars
    await submit({ ...base, deviceId: 'device-bbbb:p1', nickname: 'Bo', timeMs: 200000 }); // 1 star
    const board = await (await GET(new Request('http://x/api/leaderboard?cat=global&id=device-bbbb:p1'))).json();
    expect(board.top.map((e: { nickname: string; score: number }) => [e.nickname, e.score])).toEqual([['Ann', 6], ['Bo', 1]]);
    expect(board.top[1].me).toBe(true);
  });
});
