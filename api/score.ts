import { CATEGORIES, MISTAKE_PENALTY_MS, stars as starsFor } from '../src/game/levels';
import { CATS, clientIp, ID_RE, json, keys, LEVELS, redis } from './_redis';

const RATE_LIMIT = 30; // submissions per IP per minute
const MIN_MS_PER_QUESTION = 400;

interface Body {
  deviceId: string;
  nickname: string;
  cat: string;
  lvl: number;
  timeMs: number;
  mistakes: number;
  questions: number;
}

function validate(b: Partial<Body>): string | null {
  if (typeof b.deviceId !== 'string' || !ID_RE.test(b.deviceId)) return 'bad id';
  if (typeof b.nickname !== 'string') return 'bad nickname';
  if (!CATS.includes(b.cat as (typeof CATS)[number])) return 'bad category';
  if (!Number.isInteger(b.lvl) || b.lvl! < 0 || b.lvl! >= LEVELS) return 'bad level';
  if (b.questions !== 20) return 'bad questions';
  if (!Number.isInteger(b.mistakes) || b.mistakes! < 0 || b.mistakes! > 200) return 'bad mistakes';
  if (!Number.isInteger(b.timeMs) || b.timeMs! > 3_600_000) return 'bad time';
  // total time already includes the mistake penalty; the raw solving time must be humanly possible
  if (b.timeMs! - b.mistakes! * MISTAKE_PENALTY_MS < b.questions * MIN_MS_PER_QUESTION) return 'implausible time';
  return null;
}

const cleanName = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Player';

export async function POST(req: Request) {
  let body: Partial<Body>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const err = validate(body);
  if (err) return json({ error: err }, 400);
  const b = body as Body;

  const rl = keys.rate(clientIp(req));
  const [count] = await redis.pipeline().incr(rl).expire(rl, 60).exec<[number, number]>();
  if (count > RATE_LIMIT) return json({ error: 'slow down' }, 429);

  const name = cleanName(b.nickname);
  const score = b.timeMs; // lower is better; penalty already included
  const level = CATEGORIES.find((c) => c.id === b.cat)!.levels[b.lvl];
  const stars = starsFor(level, b.timeMs, b.questions);
  const lk = keys.level(b.cat, b.lvl);

  const prev = await redis.zscore(lk, b.deviceId);
  const improved = prev === null || score < Number(prev);
  const p = redis.pipeline().hset(keys.names, { [b.deviceId]: name });
  if (improved) {
    p.zadd(lk, { score, member: b.deviceId });
    p.hset(keys.detail(b.cat, b.lvl), { [b.deviceId]: JSON.stringify({ t: b.timeMs, m: b.mistakes }) });
  }
  await p.exec();

  // global: sum of best stars across levels
  const sk = keys.stars(b.deviceId);
  const field = `${b.cat}:${b.lvl}`;
  const old = Number((await redis.hget(sk, field)) ?? 0);
  if (stars > old) {
    await redis.hset(sk, { [field]: stars });
    await redis.zincrby(keys.global, stars - old, b.deviceId);
  }

  const rank = ((await redis.zrank(lk, b.deviceId)) ?? 0) + 1;
  return json({ rank, improved, stars });
}
