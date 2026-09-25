import { CATS, ID_RE, json, keys, LEVELS, redis, unavailable } from './_redis.js';

const LIMIT = 50;

interface Entry {
  rank: number;
  nickname: string;
  score: number;
  timeMs?: number;
  mistakes?: number;
  me?: boolean;
}

export async function GET(req: Request) {
  const down = unavailable();
  if (down) return down;
  const url = new URL(req.url);
  const cat = url.searchParams.get('cat') ?? 'global';
  const id = url.searchParams.get('id') ?? '';
  const me = ID_RE.test(id) ? id : null;
  const global = cat === 'global';
  let key = keys.global;
  let detailKey: string | null = null;
  if (!global) {
    const lvl = Number(url.searchParams.get('lvl'));
    if (!CATS.includes(cat as (typeof CATS)[number]) || !Number.isInteger(lvl) || lvl < 0 || lvl >= LEVELS)
      return json({ error: 'bad params' }, 400);
    key = keys.level(cat, lvl);
    detailKey = keys.detail(cat, lvl);
  }

  const raw = await redis.zrange<(string | number)[]>(key, 0, LIMIT - 1, { withScores: true, rev: global });
  const ids: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    ids.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }

  let myRank: number | null = null;
  let myScore: number | null = null;
  if (me && !ids.includes(me)) {
    const [r, s] = await Promise.all([global ? redis.zrevrank(key, me) : redis.zrank(key, me), redis.zscore(key, me)]);
    if (r !== null && s !== null) {
      myRank = r + 1;
      myScore = Number(s);
    }
  }

  const all = myRank ? [...ids, me!] : ids;
  const [names, details] = await Promise.all([
    all.length ? redis.hmget<Record<string, string>>(keys.names, ...all) : null,
    detailKey && all.length ? redis.hmget<Record<string, unknown>>(detailKey, ...all) : null,
  ]);

  const entry = (id: string, rank: number, score: number): Entry => {
    const d = details?.[id] as { t: number; m: number } | string | undefined;
    const det = typeof d === 'string' ? (JSON.parse(d) as { t: number; m: number }) : d;
    return {
      rank,
      nickname: names?.[id] ?? 'Player',
      score,
      timeMs: det?.t,
      mistakes: det?.m,
      me: id === me || undefined,
    };
  };

  // equal scores share a rank
  const top: Entry[] = [];
  ids.forEach((id, i) => {
    const rank = i > 0 && scores[i] === scores[i - 1] ? top[i - 1].rank : i + 1;
    top.push(entry(id, rank, scores[i]));
  });

  return json(
    { top, me: myRank && myScore !== null ? entry(me!, myRank, myScore) : null },
    200,
    { 'cache-control': me ? 'private, max-age=10' : 'public, s-maxage=15, stale-while-revalidate=60' },
  );
}
