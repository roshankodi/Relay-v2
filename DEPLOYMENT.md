# Deployment

The app is a single Node.js process with no build step, so deployment is
just: get the code + `.env` values onto a host that runs `node server.js`.

## Option A — Docker (any host: Fly.io, Render, a VPS, ECS, etc.)

```bash
docker build -t relay .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  -e GOOGLE_API_KEY=... \
  -e NODE_ENV=production \
  relay
```

The image has a built-in `HEALTHCHECK` that hits `/`.

## Option B — Plain Node host (Render, Railway, a VPS with a process manager)

- Start command: `node server.js`
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `GOOGLE_API_KEY`, `NODE_ENV=production` in the platform's environment
  variable settings.
- No build command needed.
- If you're behind a reverse proxy / load balancer, make sure it forwards
  `X-Forwarded-For` — it's used for rate limiting and should also be used
  to set `X-Forwarded-Proto` if you terminate TLS upstream.

## Before you deploy

1. **Rotate any credentials that were ever shared outside your own
   environment** (see the security note in `README.md`).
2. Apply `supabase/migrations/0001_initial.sql` to your Supabase project.
3. In the Supabase Dashboard, enable email/password sign-in (and configure
   Google as an OAuth provider there directly, if you want it — this app
   doesn't need `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` itself for that).
4. Run `npm test` — it needs no network access or real credentials.
5. Run the app locally with real credentials once (`npm run dev`) and walk
   through: sign up, create a workspace from a public Drive folder URL,
   confirm files show up, open one, leave a comment.
6. Set `NODE_ENV=production` in your deployment so session cookies get the
   `Secure` flag — this requires the app to be served over HTTPS, which
   your host (Fly.io, Render, etc.) or reverse proxy typically handles.

## Notes on scale

- The in-memory rate limiter (`lib/ratelimit.js`) is per-process. If you run
  more than one instance behind a load balancer, replace it with a shared
  store (e.g. Redis) — right now two instances each enforce their own limit
  independently.
- The comment list refreshes via polling every 5 seconds rather than a
  realtime subscription — fine for review workflows, but if you need
  sub-second updates at higher scale, that's the piece to revisit first.
