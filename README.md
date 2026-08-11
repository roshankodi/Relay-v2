# Relay — Drive media reviews

Review video, audio, and image files straight from a public Google Drive
folder: timestamped comments, timeline range markers, and click-to-annotate
image markers, shared with your team.

## Why this version looks different

This is a rebuild of a previous Next.js/React version, done specifically to
eliminate an entire category of failure: **there is no build step and no
npm package to install.** The server is plain Node.js using only built-in
modules (`node:http`, `fetch`, etc.); the frontend is plain HTML/CSS/JS
served as-is. `package.json` has zero dependencies. If something breaks now,
it's an actual application bug you can see in `server.js` — not a dependency
resolution failure, a bundler config issue, or a framework version mismatch.

Trade-offs made to get there:
- **No React** — pages are static HTML with small `<script type="module">`
  blocks calling a JSON API.
- **No Supabase SDK** — the server talks to Supabase's Auth and PostgREST
  HTTP APIs directly via `fetch`. Same database, same Row Level Security
  policies, same behavior — just no SDK dependency.
- **No `googleapis` package** — Drive folder scanning calls the Drive v3
  REST API directly.
- **No realtime websocket subscription** — the review page polls for new
  comments every 5 seconds instead of subscribing to Supabase Realtime.
  Simpler and dependency-free; the trade-off is a few seconds of latency on
  a new comment showing up for other reviewers.

Everything else — the database schema, RLS policies, validation rules,
comment-anchor model (exactly one of timestamp / range / image marker per
comment) — is unchanged from the previous version.

## Security note

If you're picking this project up after a prior review or a shared zip
export, rotate your Supabase anon key and any Google API key that was ever
included in a file you shared with someone else — treat anything that left
your machine as compromised, regardless of git history.

## Quick start

```bash
npm install        # no-op today — kept here for when/if a dependency is ever added
cp .env.example .env
# edit .env with your Supabase project URL/anon key and a Drive-restricted Google API key
npm run dev         # http://localhost:3000, auto-restarts on file changes
```

Run the test suite (pure unit tests, no network or credentials required):

```bash
npm test
```

## Project layout

```
server.js            HTTP server: routing, static files, JSON API
lib/
  supabase.js         Auth + PostgREST calls via fetch (no SDK)
  drive.js             Google Drive v3 REST calls via fetch (no SDK)
  session.js            Cookie-based session + token refresh
  validate.js            Input validation (mirrors the DB constraints)
  cookies.js               Cookie parsing/serialization
  ratelimit.js               Per-instance in-memory rate limiting
public/               Static HTML/CSS/JS — no build step
supabase/migrations/  Database schema + RLS policies (unchanged)
tests/                node:test unit tests
```

## Database setup

Apply both migrations in `supabase/migrations/`, in order, via the SQL
Editor or `supabase db push`:
- `0001_initial.sql` — core schema (`profiles`, `workspaces`,
  `workspace_members`, `media`, `comments`) with Row Level Security
  restricting everything to workspace members, and a trigger that creates
  a `profiles` row on signup.
- `0002_sharing_and_guests.sql` — adds public workspace sharing and guest
  commenting (no account required). **Read the comment block at the top
  of that file** — it documents the security model (share tokens, guest
  capability tokens), since it changes how access control works for
  anyone using a share link.

## Public sharing & guest commenting

A workspace owner can turn on a public share link from the Share button on
a workspace page. Anyone with that link can view media and comment without
an account — reviewers are prompted once for a name and email (stored only
in their own browser), then can view, comment, and edit/delete their own
comments. The link itself is a 128-bit random token — not guessable — and
disabling sharing or regenerating the link immediately revokes it.

## "Continue with Google" setup

The code path is fully implemented (`/auth/google` redirects into
Supabase's OAuth flow; `/auth/callback` completes it and sets a normal
session), but it needs configuration this app's code can't do for you:
1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web
   application) and add `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
   as an authorized redirect URI.
2. In the Supabase Dashboard, under Authentication → Providers, enable
   Google and paste in that client ID and secret.

Until that's done, the button will redirect to an error from Supabase
rather than Google's consent screen — expected, not a bug in this code.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon/public key — safe for this to be visible, RLS enforces access |
| `GOOGLE_API_KEY` | yes | Drive API key, scoped to the Drive API only |
| `PORT` | no | Defaults to 3000 |
| `NODE_ENV` | no | Set to `production` in deployment — enables `Secure` cookies |

Nothing else is needed. There is intentionally no service-role key anywhere
in this app — every database call runs with the signed-in user's own token,
so it's always subject to Row Level Security.

See `DEPLOYMENT.md` for deployment instructions.
