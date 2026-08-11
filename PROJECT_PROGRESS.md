# Project Progress

## Rebuild (this version)

Rebuilt from the previous Next.js/React/Supabase-SDK version as a
dependency-free Node.js app after reports that "everything" was failing on
the previous stack. Rationale: with zero npm dependencies and no build
step, there is no `npm install`/bundler/framework-version failure surface
left — if this version breaks, it'll be an application bug visible directly
in `server.js`, not a tooling problem.

What's preserved exactly:
- Database schema and Row Level Security policies
  (`supabase/migrations/0001_initial.sql`, byte-for-byte the same file).
- The comment data model: a comment has exactly one anchor
  (timestamp, timeline range, or image marker).
- The Drive scanning behavior: recursive walk of a public folder, same
  supported mime types (`video/mp4`, `audio/mpeg`, `image/png`,
  `image/jpeg`), same sync-marks-missing-files-deleted logic.
- Auth model: Supabase-issued JWTs, RLS-enforced access, no service-role
  key anywhere in the app.

What changed, and why:
- React/Next.js → static HTML + vanilla JS. No build step to fail.
- `@supabase/ssr` + `@supabase/supabase-js` → direct `fetch` calls to
  Supabase's Auth and PostgREST HTTP APIs. Same backend, no SDK version to
  drift out of sync with the API.
- `googleapis` → direct `fetch` calls to the Drive v3 REST API.
- `zod` → a small hand-written validator (`lib/validate.js`) enforcing the
  same rules (covered by `tests/validate.test.js`).
- Supabase Realtime (websocket) comment subscription → 5-second polling.
  Simplest dependency-free option; costs a few seconds of latency on new
  comments appearing for other viewers.

Verified in this environment (no network access available here, so this is
as far as verification could go without live Supabase/Google credentials):
- `npm test` — 11/11 passing, pure unit tests of validation and Drive URL
  parsing logic, no network required.
- `node --check` on every module — no syntax errors.
- Booted the server and curl-tested: landing page (200), login page (200),
  unauthenticated `/app` (302 redirect to `/login`), static assets (200),
  unauthenticated `/api/session` (401), unknown route (404), security
  headers present on every response, and a login attempt against an
  unreachable Supabase host fails gracefully with a JSON error instead of
  crashing the process.

Not verified here (needs real credentials and network access you'll have in
your own environment, not this sandbox): actual Supabase auth round-trip,
Drive folder scanning against a real folder, RLS behavior against a live
database, comment polling end-to-end. Walk through the checklist in
`DEPLOYMENT.md` before going live.

## Audit pass 2 — see CHANGELOG.md

Fixed a cross-platform test-runner bug, made the SQL migration idempotent
(likely root cause of the RLS error), fixed a refresh-token race condition,
and closed a cross-workspace comment-injection gap. Test count 11 → 18. Full
details in CHANGELOG.md. Credentials still not rotated — see that file.
