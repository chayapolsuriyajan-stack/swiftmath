# SwiftMath

A web take on *Quick Math – Mental Arithmetic*: timed mental math where you write the answers by hand. It's built for Apple Pencil on iPad and also works with a finger or mouse.

- 6 categories × 12 levels × 20 questions. Stars depend on your pace, and each mistake adds a 2 s penalty.
- On-device handwriting: a tiny CNN (57 KB, int8) plus a personal model that learns your own digit shapes. You calibrate it once, a warm-up runs before levels, and it keeps learning from every correct answer.
- Pencil input with graphite-style ink: pressure sets darkness and width, tilt gives shading, a hover dot shows where the tip will land, and there's palm rejection and scratch-out to erase.
- The next question is previewed faintly under the current one.
- High scores are kept per device across all players. An online leaderboard (Vercel Functions + Upstash Redis in `api/`) is built but switched off: set `ONLINE = true` in `src/store/scores.ts` once a Redis store is connected.
- Installable PWA that plays fully offline.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173, also on your LAN for testing on an iPad
npm test
```

## Retrain the digit model (optional)

```bash
python scripts/train/train_digits.py   # PyTorch; writes public/model/* and tests/fixtures/cnn.json
```

## Deploy (Vercel)

1. `npm i -g vercel`, then `vercel link`.
2. In the Vercel dashboard, go to **Storage → Marketplace → Upstash for Redis** and connect it to the project. This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
3. `vercel --prod`
