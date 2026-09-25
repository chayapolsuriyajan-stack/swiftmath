import { Redis } from '@upstash/redis';

// Upstash for Redis via the Vercel Marketplace injects KV_REST_API_*; plain Upstash uses UPSTASH_REDIS_REST_*.
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
export const configured = Boolean(url && token);
export const redis = new Redis({ url: url ?? 'https://unconfigured.invalid', token: token ?? 'none' });

export const CATS = ['add', 'sub', 'mul', 'div', 'mix', 'alg'] as const;
export const LEVELS = 12;
export const ID_RE = /^[\w:-]{8,100}$/;

export const keys = {
  level: (cat: string, lvl: number) => `lb:${cat}:${lvl}`,
  detail: (cat: string, lvl: number) => `lbd:${cat}:${lvl}`,
  global: 'lb:global',
  names: 'names',
  stars: (id: string) => `stars:${id}`,
  rate: (ip: string) => `rl:${ip}`,
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** 503 when no Redis store is connected to the project yet. */
export const unavailable = () => (configured ? null : json({ error: 'leaderboard not configured' }, 503));

export function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}
