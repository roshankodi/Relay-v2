# Changelog — this audit pass

## Fixed

1. **`npm test` failed on Windows (`Could not find tests/*.test.js`)**
   Root cause: `"test": "node --test tests/*.test.js"` relies on the shell
   expanding the `*` glob. Bash does that; PowerShell/cmd.exe don't, so Node
   received the literal string `tests/*.test.js` and failed to find a file
   with an asterisk in its name. Fixed to `"node --test"`, which uses
   Node's own built-in test-file discovery — works identically on every
   shell, no glob involved. Verified: `npm test` now passes on this
   machine; you should see the same on Windows.

2. **SQL migration failed on rerun (`relation "profiles" already exists`, 42P07)**
   Rewrote `supabase/migrations/0001_initial.sql` to be idempotent:
   `create table if not exists`, `create or replace function`, and
   `drop policy/trigger if exists` immediately before every `create`. Also
   added explicit `grant` statements for the `authenticated`/`anon` roles
   (Supabase normally sets these up automatically, but stating them
   explicitly makes the migration self-repairing if grants were ever
   altered) and guarded the realtime publication add with an existence
   check. **Re-running this file is now always safe**, on a fresh database
   or one that's already partially set up — this is also the most likely
   fix for the workspace-creation RLS error, since a corrupted/partial
   prior run is the most probable explanation for a policy silently
   drifting from what the SQL Editor shows.
   Added `supabase/diagnostics.sql` — four read-only queries to run if the
   RLS error persists after reapplying the migration: confirms the
   policies exist, confirms the `authenticated` role actually has INSERT
   privilege on the table (separate from RLS — a missing grant produces
   the identical error message), and lets you cross-check the signed-in
   user's id against `auth.users`.

3. **Refresh-token race condition (real bug, not yet reported but found in review)**
   Supabase rotates refresh tokens on every use — the old one is
   invalidated the instant a new one is issued. Two concurrent requests
   with the same expired access-token cookie (easily triggered — the
   review page polls every 5s) would both try to redeem the same
   already-consumed refresh token; the loser would fail and the user would
   appear randomly logged out. Fixed with in-flight de-duplication in
   `lib/session.js` — concurrent requests now share one refresh call
   instead of racing. Added `tests/session.test.js`, which reproduces the
   race with a mocked `fetch` and fails without the fix (verified by
   temporarily reverting it and re-running the test before finalizing this
   change).

4. **Cross-workspace comment injection (security finding, not yet reported)**
   `POST /api/comments` trusted a client-supplied `workspaceId` for the
   RLS "can I comment here" check, but never verified the `mediaId` in the
   same request actually belonged to that workspace. A legitimate member
   of workspace A could submit `workspaceId: A` (passes the check) with a
   `mediaId` from workspace B, attaching a comment to media they have no
   access to. Postgres `CHECK` constraints can't reference other tables,
   so this needed an application-layer fix: the server now looks up the
   media row's real `workspace_id` (itself RLS-gated — a `mediaId` from a
   workspace you're not a member of now correctly 404s) and uses that,
   ignoring any workspace id the client sends. Updated `public/media.html`
   to match (stopped sending a now-unused `workspaceId` field).

## Added

- `tests/cookies.test.js` — cookie parsing/serialization edge cases
- `tests/session.test.js` — the refresh race-condition regression test
- `supabase/diagnostics.sql` — RLS/grant troubleshooting queries

Test count: 11 → 18, all passing (`npm test`).

## Not done / still needs your attention

- **Your credentials are still not rotated.** This is the second time
  the exact same Supabase service role key, anon key, and Google OAuth
  client secret have been uploaded to me, unchanged from the very first
  review. I can't rotate them for you — that has to happen in the
  Supabase dashboard and Google Cloud Console. Everything else in this
  changelog is a real fix; this one item is still outstanding and is the
  single highest-impact thing left.
- I still can't connect to your live Supabase project from this sandbox
  (no network access here), so the RLS fix is my best-evidence diagnosis
  from reading the actual policy/grant definitions — not something I
  watched succeed against your real database. Re-run the migration, then
  try creating a workspace; if it still 403s, run `supabase/diagnostics.sql`
  query #2 and tell me what it returns — that'll tell us definitively
  whether it's a grant issue or something else.
- The 10-phase request asked for an exhaustive pass across accessibility,
  SEO, monitoring hooks, CI, etc. I focused this pass on the concrete,
  reproducible bugs (test runner, migration, auth race, authorization
  gap) plus a security review of the request-handling code, rather than
  touring every item on the list without a specific finding attached to
  it — I'd rather hand you four verified, real fixes than a long list of
  unverified claims.

## Audit pass 3 — the actual RLS root cause, found via live diagnostics

Confirmed via decoded JWT claims and the raw PostgREST error body (Postgres
code `42501`) that `owner_id` matched `auth.uid()` exactly — the INSERT
policy itself was never the problem.

**Real cause:** the app requests `Prefer: return=representation` on
workspace creation (so it gets the new row's `id` back), which makes
PostgREST perform `INSERT ... RETURNING *`. Postgres requires a `RETURNING`
clause to also satisfy the table's `SELECT` policy — not just the `INSERT`
policy's `WITH CHECK`. The only `SELECT` policy on `workspaces` was
`"workspace view"` (`is_member(id)`), and a brand-new workspace has no
`workspace_members` row yet — that row is only created in the *next*
request, using the id this one was supposed to return. Chicken-and-egg:
insert succeeds, but Postgres can't legally hand the row back, so the whole
statement fails with the same error message as an actual authorization
failure.

**Fix:** added a second, permissive `SELECT` policy —
`"workspace view own"` using `owner_id = auth.uid()` — so an owner can
always see their own workspace regardless of membership-row timing.
Permissive policies are OR'd, so this doesn't loosen anything for anyone
else; it only adds the one case that was structurally impossible before.

Action needed: re-run `supabase/migrations/0001_initial.sql` once more —
it's still idempotent, this only adds the one new policy.

## Audit pass 4 — comments/media loading (400: no relationship between comments and profiles)

**Cause:** `select=*,profiles(display_name,avatar_url)` asks PostgREST to
auto-embed `profiles` inside `comments` via a foreign key between those two
tables. No such FK exists — `comments.author_id` and `profiles.id` both
independently reference `auth.users(id)`, but not each other, so PostgREST
has nothing to walk between them. This was in the original schema design,
not something introduced by earlier fixes in this thread.

**Fix:** replaced the embed with an explicit application-level join
(`attachProfiles()` in `server.js`) — fetch comments, collect the unique
`author_id`s, fetch just those profiles in one batched request, merge in
JS. Output shape is identical to what the embed would have produced, so no
frontend changes were needed beyond removing the now-unused embed syntax.
Chose this over adding a second foreign key to the schema because it needs
no migration, has no risk of failing against existing data, and doesn't
depend on PostgREST's schema-cache refresh timing.

Added `tests/profiles-join.test.js` — confirms duplicate authors are
batched into a single request rather than one request per comment.

Test count: 18 → 19, all passing.

## Audit pass 5 — full production pass (player redesign, image fixes, UI polish)

### Mandatory items

1. **Cancel button.** Was sharing generic `.btn-ghost` styling with nav
   buttons. Added a dedicated `.btn-cancel` class — neutral slate tone,
   distinct hover/active/disabled/focus-visible states — used on the "New
   workspace" dialog's Cancel button.

2. **Drive images not loading — root cause and fix.** The app was linking
   directly to `drive.google.com/uc?export=download`, Google's legacy
   direct-download URL. That endpoint is unreliable for inline embedding:
   above a size threshold (and inconsistently for images specifically),
   Google serves an HTML "can't scan this file for viruses" interstitial
   page instead of raw bytes — which silently breaks an `<img>`/`<video>`
   pointed at it. Replaced with a proper server-side streaming proxy
   (`GET /api/media/:id/file` in `server.js`, `fetchDriveFile()` in
   `lib/drive.js`) that calls the Drive v3 API's `alt=media` endpoint and
   pipes the real bytes through, forwarding `Range` headers so video
   seeking still works (`206 Partial Content`). Access is gated by the
   same RLS-scoped lookup every other read uses, and rate-limited
   separately to protect the Drive API quota. Grid thumbnails also now
   fade in on load and fall back to a kind icon on error instead of a
   broken image icon.

3. **Image marker/pointer accuracy, including zoom and resize.** The old
   marker code computed click position against the full `<img>` element's
   bounding box, but the image was rendered with `object-fit: contain` —
   meaning any letterboxing (image aspect ratio ≠ container aspect ratio)
   silently offset every marker from where the reviewer actually clicked.
   Rewrote the image viewer to size a wrapper `.image-frame` in JS to
   exactly match the image's rendered content box (no letterboxing), then
   position markers by percentage *inside that frame* — percentages now
   correspond 1:1 with the visible image regardless of window size.
   Added pinch/scroll zoom and drag-to-pan (`.image-frame` is the element
   that gets `transform: translate() scale()`; markers are children of
   it, so they move and scale with the image automatically at any zoom
   level — no separate recalculation needed while zoomed).

4. **Video commenting system — full redesign.** Replaced the native
   `<video controls>` element (no way to overlay anything on a browser's
   built-in scrubber) with a custom player: a `.scrubber` progress bar
   with a played-fill, buffered indicator, draggable handle,
   click/drag-to-seek, and comment markers rendered as small dots at
   their timestamp position (range comments render as a highlighted
   segment). Comment cards were redesigned with colored initials avatars,
   a timecode badge, relative timestamps ("2h ago"), and an active-state
   highlight. Custom play/pause, ±5s, and volume controls, all with
   visible focus states for keyboard use. Applied the same scrubber UI to
   audio playback.

5. **Comment/timeline synchronization.** Clicking a comment card now
   seeks the player to its timestamp (or start-of-range) and highlights
   the card; clicking a marker on the scrubber does the same in reverse;
   during playback, the comment nearest the current time is automatically
   highlighted and scrolled into view as it plays. The equivalent applies
   to image markers: clicking a marker highlights its comment card and
   vice versa.

### Also fixed while reviewing the rest of the codebase

- Replaced a `window.__x` global-variable pattern used for internal
  wiring between the player and the comment list with proper
  module-scoped closures — same behavior, no global namespace pollution.
- `fmtTime()` previously broke silently for anything over 59 minutes
  (used `toISOString().slice(14,19)`); rewrote to a proper
  `h:mm:ss`/`m:ss` formatter.
- Added `timeAgo()`, `initials()`, and `avatarColor()` helpers to
  `shared.js`, reused by the new comment cards.
- Added a consistent `:focus-visible` ring across every interactive
  element site-wide (buttons, links, inputs) instead of only inputs
  having a focus style — keyboard navigation now has visible focus
  everywhere, without adding a visible ring on mouse clicks.
- Added `prefers-reduced-motion` handling for all animations/transitions.
- Workspace grid thumbnails: fade-in on load, graceful icon fallback on
  load error (previously a broken-image icon), retry button on a failed
  workspace load (previously a dead-end error message).
- Added rate limiting to the new file-streaming route.

### What this pass didn't touch, and why

- No build step, bundler, or TypeScript exists in this project by design
  (see the original rebuild's README) — "zero TypeScript errors",
  "code splitting", "resolve dependency conflicts" don't apply to this
  stack. `node --check` on every file plus the full test suite is the
  applicable equivalent, and both pass clean.
- Didn't touch authentication, RLS, or the database schema in this pass —
  those were fixed and verified against your live project in earlier
  rounds and are working; re-touching them without a reported problem
  would risk regressing something already confirmed working.
- Your Supabase and Google credentials in `.env` are still the original,
  unrotated ones from the very first review. Not fixing this in code —
  it has to happen in the Supabase dashboard and Google Cloud Console.

Test count: 20/20 passing (`npm test`). Verified server boot + routing
(including the new file proxy, auth-gating, and rate limiting) via curl
smoke tests in this environment; could not exercise the live Drive/video
UI end-to-end here since that needs your real Drive folder and browser —
walk through creating/opening a workspace once more after this update.

## Audit pass 6 — collaboration features (delete, sync, timeline ranges, public sharing, guests, OAuth)

This was a large expansion. Everything below was implemented and verified
by hand (syntax checks on every file, full test suite, and boot/routing
smoke tests) — but the guest-access and sharing RLS design could not be
exercised against a live Supabase project from this sandbox (no network
access here). Test it against your real project before relying on it, and
see the "not done" section at the bottom for what's explicitly out of
scope.

### 1. Delete comments (video & photo)

- Every comment card now shows edit/delete actions when you're allowed to
  use them — computed server-side (`lib/comments.js: sanitizeComment`),
  never left for the client to decide.
- A comment's own author can always edit/delete it; the workspace owner
  can additionally delete (not edit — moderation should mean removal, not
  silently rewriting someone else's words) anyone's comment in their
  workspace.
- A styled confirmation dialog (`confirmDialog()` in `shared.js`) replaces
  the browser's plain `confirm()`, matching the rest of the UI.
- Deletion is optimistic: the card fades out and the list, count, and
  timeline markers update immediately — no page refresh, no waiting on a
  refetch.
- Photo markers renumber automatically because they're numbered by
  position in the current comment list on every render, not by a stored
  index — deleting marker #2 makes the old #3 become #2 with no special
  case needed.

### 2. Automatic synchronization

- The 5-second poll now diffs by `id:updated_at` signature instead of
  just comment count — catches edits to existing comments and a
  delete-plus-add landing in the same interval, which a length-only
  comparison (the previous implementation) would have missed entirely.
- Every mutation (create/edit/delete) updates local state immediately
  instead of waiting for the next poll tick.

### 3. Frame.io-inspired timeline range selection

Replaced the old "check a box, range end = wherever you currently are"
mechanism with real click-and-drag selection on the scrubber:
- Point/Range mode toggle in the composer.
- In Range mode, dragging on the timeline creates a selection live (the
  video scrubs to the drag position in real time as a preview).
- Draggable start/end resize handles, plus drag-the-middle to move the
  whole range at once.
- Editable numeric start/end time fields, synced bidirectionally with the
  visual handles.
- Selected region highlighted on the timeline (dashed while
  pending/being edited, solid once posted).
- Clicking a range comment's card seeks to its start and highlights the
  region on the timeline; clicking the highlighted region on the timeline
  scrolls to and highlights the comment. Same bidirectional sync for
  point-timestamp markers.
- Snapping is to 100ms increments as an approximation of "frame
  accurate" — the Drive API doesn't expose a file's actual frame rate, so
  true frame-boundary snapping isn't available without that information.
- Timeline zoom was explicitly marked "if supported" in the request and
  was not implemented in this pass.

### 4-7. Public workspace sharing, guest commenting, owner Google sign-in, sharing management

- **Sharing**: a Share button on the workspace page (owner-only) opens a
  dialog with an on/off toggle, the copyable link, and a regenerate
  action. Enabling/regenerating issues a new 128-bit random token
  (`crypto.randomBytes(24)`); disabling clears it, immediately revoking
  every outstanding link.
- **Guest access**: opening a share link (`/review/:token`) never shows a
  login screen. A guest can view media and comments immediately; the
  first time they try to comment, a dialog asks for name and email
  (stored in `localStorage`, not a server account) and generates a
  private capability token for editing/deleting their own comments later.
  The workspace owner sees each guest's name and email on their comments.
- **Owner Google sign-in**: `/auth/google` redirects into Supabase's OAuth
  flow; `/auth/callback` reads the returned tokens from the URL fragment
  (client-side only) and exchanges them for the same httpOnly session
  cookies password login uses. Needs Google Cloud + Supabase dashboard
  configuration — see README.
- **Workspace deletion**: owner-only, two-step confirmation, deletes the
  workspace row — cascades to members/media/comments via the foreign
  keys that already existed in 0001, so no new cleanup logic was needed.
  Never touches Google Drive; the app only ever stored references.

### Security design notes (read `0002_sharing_and_guests.sql`'s header for the full model)

- `guest_token` (the capability secret proving a guest owns a comment) is
  **never** included in any API response. `sanitizeComment()` computes
  `isMine`/`canEdit`/`canDelete` server-side and strips the raw token
  before the JSON is built — the only way a guest can act on their own
  comment is because their browser already remembers the token it
  generated.
- Caught and fixed during this pass: an early draft of the guest-access
  migration granted the `anon` Postgres role table-level SELECT on
  `profiles`, which combined with the existing unconditional
  `using (true)` policy from 0001 would have let *any* anonymous visitor
  enumerate every registered user's display name — not just guests
  holding a valid share link. Fixed by scoping anon's profile visibility
  to "authored a comment in a workspace this specific share token
  unlocks" and tightening the original policy to `to authenticated`
  explicitly.
- Public routes (`/api/public/*`) get their own, stricter rate limits
  (separate from the authenticated ones) since anonymous requests have no
  account-creation friction slowing down abuse.

### Also fixed while implementing the above

- Extracted `sanitizeComment`/`sanitizeComments` into `lib/comments.js` so
  they're unit-testable without importing `server.js` (which boots a real
  HTTP server as an import side effect).
- Extracted the entire player/timeline/comment-list implementation into
  `public/js/player.js`, shared between the account-holder and guest
  review pages via a small backend adapter — this feature is large enough
  that duplicating it per page would have meant two copies drifting out
  of sync.
- Removed an "owner can edit anyone's comment" RLS policy from an early
  draft of this migration after reconsidering it — moderation should mean
  delete, not silently rewriting someone else's words.

### Explicitly NOT done in this pass, and why

Bolting these onto everything above in the same pass would have meant
rushing the security-sensitive parts (guest access, sharing) to fit
everything in — not done:
- Comment replies/threading
- Resolve/unresolve comment status
- An activity feed
- Notification badges
- Timeline zoom (marked optional in the request)

Test count: 24 → 31, all passing (`npm test`). Verified via `node --check`
on every modified/new file, full boot + routing smoke tests (including
auth-gating, the OAuth redirect URL construction, and public-route
behavior) — but not against a live Supabase project or a real Google
OAuth app, which this sandbox can't reach. Apply `0002_sharing_and_guests.sql`,
then walk through: enable sharing on a workspace, open the link in a
private/incognito window, provide a guest identity, post/edit/delete a
comment, and confirm the owner sees it — before treating this as verified
end-to-end.

## Audit pass 7 — reviewer names, media-level sharing, verification pass

### 1-2. Actual reviewer names (root cause found, not just patched)

The "Reviewer" fallback wasn't a display bug — `Full name` already existed
on the signup form but wasn't `required`, so accounts created without
filling it in got an empty `display_name`, which correctly (by design)
falls back to "Reviewer" in the comment UI. Two fixes:
- **Going forward**: `Full name` is now required at signup, both
  client-side (the `required` attribute is toggled in sync with the
  field's visibility, avoiding the "hidden required field" browser
  validation trap) and server-side (`handleSignup` now rejects a
  missing/short name with a 422, so this can't be bypassed by calling the
  API directly).
- **Existing accounts** that already have a blank name: the dashboard now
  shows a one-time banner prompting for a name, saved via a new
  `PATCH /api/profile` endpoint. This uses the "profile self update" RLS
  policy that already existed in `0001_initial.sql` — no schema change
  needed, exactly as asked.
- `/api/session` now returns the caller's profile alongside their auth
  user, so the frontend can check `display_name` without an extra round
  trip; `requireSession()` in `shared.js` was updated to return the full
  `{ user, profile }` shape (the three pages that call it were updated
  accordingly).

### 3-4. Public media sharing

Added a Share button directly on the media review page, alongside the
existing workspace-level one. Both are backed by the same underlying
workspace share token — **documented tradeoff, not a silent gap**: a
"share this video" link opens straight to that file (satisfying "no
unnecessary redirects" / "media should load correctly"), but since
sharing is workspace-scoped in the current schema, someone with that link
can also navigate to the rest of the workspace from there. True
per-file-only isolation would need a new share-scope column, which the
instructions for this change explicitly said not to add to the database.
The dialog's copy says this outright rather than leaving it to be
discovered. Extracted the share dialog (previously only on the workspace
page) into `public/js/share-dialog.js` so both pages use one
implementation instead of two copies.

### 5. Guest commenting popup

Already implemented from the previous pass; matched wording more closely
to the reference workflow (button now says "Save" rather than
"Continue"). Functionally unchanged — name + email only, no login,
comment immediately after.

### 6-7. Share link reliability — re-verified, one gap closed

Re-traced every route involved: `/review/:token`, `/review/:token/media/:id`,
and their API counterparts under `/api/public/*` — confirmed none of them
call `servePage(..., { auth: true })`, so there's no login redirect for
guests, and confirmed `resolveShareToken()` cleanly 404s instead of
crashing when a token is invalid or disabled. The one real gap found and
closed: the media page had no way to construct a direct-to-file link at
all before this pass (item 3) — that's now fixed rather than "verified."
I can't literally open a second browser or Incognito window from this
sandbox; verified behavior via boot/routing smoke tests (a fresh request
with no session cookie hits every guest route and gets the right
response) rather than a real cross-browser check — do that yourself once
deployed, especially the Incognito case.

### 8. Video timeline comments

Already fully implemented in the previous pass (bidirectional
comment↔timeline sync, active-comment highlighting, live marker sync
during playback) — reviewed against your reference image and it matches
the intended behavior; no functional changes made here.

### 9. Vercel deployment — same architectural note as before, not silently dropped

This app is a single persistent Node.js process (`http.createServer()`),
which doesn't fit Vercel's serverless function model without restructuring
every route into `/api/*.js` files and moving the in-memory rate limiter
to a shared store — this was already discussed earlier in this project's
history, and Render was chosen instead (the `Dockerfile` and
`DEPLOYMENT.md` are built for exactly that). I did not attempt a rushed
Vercel port bundled into this pass — doing so carelessly risks breaking
the Render deployment that's already configured and tested, for a
platform change that's a substantial project on its own. If you want to
actually move to Vercel, say so explicitly and I'll treat it as its own
focused piece of work rather than folding it in here.

Test count unchanged at 31 (signup name validation is simple enough to be
adequately covered by the boot smoke test rather than warranting a new
unit test file). Verified via `node --check` on every modified file, full
test suite, and a boot/routing smoke test covering every new/changed
route including the new `/api/profile` endpoint and the signup
missing-name rejection.

## Audit pass 8 — name entry scope, SSL link bug

### Name entry narrowed to exactly two places

Removed the dashboard "add your name" banner and its backing
`PATCH /api/profile` endpoint (now unused, so removed rather than left as
dead code) — name entry is now only: signup (account creators, already
positioned above email/password — verified, no change needed there) and
the guest identity popup on share links (unchanged). An account that
already has a blank name from before signup required it has no in-app way
to set one now; that's the direct consequence of narrowing to these two
surfaces as asked.

### Fixed: ERR_SSL_PROTOCOL_ERROR on copied links

Root cause: `siteOrigin()` (used to build every share/OAuth-callback link)
decided `https://` vs `http://` from `NODE_ENV` — and `NODE_ENV=production`
is exactly what `.env.example` suggests for deployment. Copy that into a
local `.env` for dev testing (as happened here) and every generated link
gets `https://` even though `npm run dev` only ever speaks plain HTTP —
the browser then tries a TLS handshake against a server that isn't
listening for one. Fixed by deriving the scheme from the actual request
instead: `x-forwarded-proto` header if a reverse proxy set it (correct
for Render), otherwise whether the raw socket is actually TLS-encrypted —
never from an env var. This fixes it regardless of what `NODE_ENV` is set
to, in dev or production. Verified both cases directly: a plain HTTP
request with `NODE_ENV=production` and no proxy header now correctly
generates an `http://` link; the same request with
`x-forwarded-proto: https` (matching real deployment) generates `https://`.
Removed `isProd` from `server.js` entirely — it's still used in
`lib/session.js` for the cookie `Secure` flag, which is correctly a
deployment-intent decision rather than a connection-reality one (a
container behind Render's TLS-terminating proxy sees plain HTTP on its
own socket even though the public-facing connection is HTTPS, so cookies
*should* stay tied to `NODE_ENV`, unlike the link scheme bug above).

### Not addressed: the "Not found" boxes in your dashboard screenshot

I looked for a code-side cause and didn't find one — nothing on the
dashboard page issues a request that could produce six repeated
"Not found" results (workspace tiles don't fetch anything per-card, no
polling runs on that page). Given the toolbar icons visible in your
screenshot, my best guess is a browser extension rather than this app —
but I want to be honest that this is a guess, not a diagnosis. If it
persists in a different browser or a clean profile with no extensions,
it's real and I'll dig further with that information.

## Audit pass 9 — guest token root-cause fix, comment replies

### 1. Guest token validation error — actual root cause found and fixed

Root cause: `crypto.randomUUID()` produces a 36-character string. Guest
identity generation concatenated two of them
(`crypto.randomUUID() + crypto.randomUUID()`) to build a token — 72
characters — while the server's validation caps `guestToken` at 64
characters (`lib/validate.js`). Every guest identity ever generated by
this code failed server-side validation on every single request, on
every device — which is exactly "opens fine, but every action throws
this error, everywhere." Not a routing or auth-middleware issue, as
suspected — a client-side token generator producing an oversized token.

Fixed by generating a properly-sized token instead of raising the
server's limit to match the bug (that would have been the "just truncate
it" fix explicitly asked against): `randomToken()` in `shared.js` now
uses the Web Crypto API directly (`crypto.getRandomValues`) to produce an
18-byte, base64url-encoded, 24-character token — well within bounds, and
a cleaner secret format than two concatenated UUIDs to begin with.

Also handled the already-affected case: a guest who picked up a broken
72-character token before this fix would otherwise keep reusing it
forever (identity is normally only generated once and persisted).
`getGuestIdentity()` now validates the stored token's length on every
read and treats an invalid one as "no identity yet," so anyone already
stuck self-heals automatically the next time they try to comment, rather
than needing to manually clear their browser storage.

Added `tests/guest-token.test.js` (with a minimal in-memory
`localStorage` shim so it runs under plain Node): confirms a fresh token
is within bounds, confirms re-saving an identity keeps the same valid
token, and specifically reproduces the original 72-character bug and
confirms it self-heals.

### 2-3. Comment replies, with permissions

One additive database column — `comments.parent_id`, nullable,
`references comments(id) on delete cascade` — nothing else in the schema
changed. No new RLS policies were needed: a reply is just a row in the
existing `comments` table, so every existing policy (author can edit/
delete their own, workspace owner can delete any) already applies to
replies automatically, exactly matching the permission requirements
without touching authorization logic at all.

- Every top-level comment has a Reply button; replies don't (server
  rejects replying to a reply — `resolveParentComment()` in
  `server.js` — keeping threading exactly one level deep, "directly
  below their parent," per the request).
- Replies render nested under their parent in `public/js/player.js`,
  indented with a connecting left border, visually distinct but not a
  redesign of the existing comment card.
- A reply doesn't carry its own timeline/marker anchor — it's attached to
  its parent's context instead. `validateCommentInput` now accepts a
  `parentId` and, when present, skips the "needs exactly one anchor" rule
  required for top-level comments, and forces any anchor fields to null
  server-side regardless of what's sent (so a client can't accidentally —
  or deliberately — give a reply its own timeline marker).
- Reply creation is guarded against the same class of cross-media
  injection the original comment endpoint already defends against: the
  parent comment is looked up server-side and must belong to the same
  media the reply targets, not trusted from the client.
- Deleting a top-level comment cascades to its replies at the database
  level (the FK above); the UI removes them from local state
  immediately too, rather than waiting for the next poll, and the
  confirmation dialog says so explicitly when a comment being deleted has
  replies.
- No adapter/API-shape changes were needed on the guest side — the
  existing guest `createComment` adapter already spreads whatever payload
  it's given before attaching identity fields, so a reply payload
  (`{ mediaId, parentId, body }`) flows through unchanged.

Permission enforcement — both frontend (buttons only render when
`canEdit`/`canDelete` are true) and backend (RLS) — required no new code
for replies specifically, since `sanitizeComment()` already computes
these flags per-row regardless of whether that row is a top-level
comment or a reply.

Test count: 31 → 37 (3 new guest-token tests, 3 new reply-validation
tests, plus one test file rename cleanup along the way). Verified via
`node --check` on every modified file, full test suite, and boot/routing
smoke tests covering the reply endpoints' auth-gating. Could not exercise
the full reply flow against a live Supabase project (no network access in
this sandbox) — apply `0003_replies.sql`, then actually post a reply,
edit it, delete it, and confirm a workspace owner can delete someone
else's reply, before treating it as verified end-to-end.

## Audit pass 10 — visual redesign (design tokens + App Shell layout)

Applied the new visual design system from `relay-ui-design-system.md`
(brand green palette, spacing/radius/shadow scale, App Shell + Sidebar
layout, Anchor Chip / Comment List Item / Timeline Bar component
patterns). Pure CSS + markup pass — verified against the original by
diff, byte-for-byte:

- `server.js`, every file in `lib/`, and `supabase/*.sql` — **untouched**
- `public/js/player.js`, `guest-identity.js`, `share-dialog.js`,
  `shared.js` — **untouched**. Every visual change flows through CSS
  rewrites of existing class names (`.comment-card`, `.scrubber-marker`,
  `.anchor-badge`, etc.) that the JS already emits — no template-string
  changes were needed, meaning zero risk to any `id`/`data-*` hook the JS
  queries.
- Comment-anchor model (exactly one of timestamp/range/image-marker) —
  untouched, lives entirely in `lib/validate.js` (see above).

### What changed

- **`public/css/tokens.css`** (new) — the full token set from the spec.
  The spec only defines a light palette; Relay already had working dark
  mode (existing functionality), so I added a `.dark` override block
  using the same token names with dark-appropriate values, rather than
  losing that feature to the redesign.
- **`public/styles.css`** — every existing component rule (buttons,
  cards, dialogs, the comment list, the scrubber/timeline, the image
  viewer) now derives its colors/radius/shadow/spacing from the new
  tokens instead of the old ad hoc variables — same class names
  throughout. Buttons are now pill-shaped per the spec's "Primary
  Button" component. Added the new App Shell / Sidebar / Top Bar layout
  classes (`.app-shell`, `.sidebar`, `.sidebar-nav-item`, `.shell-card`)
  and a `.shell-card-wide` variant for content-heavy guest pages.
  `.anchor-badge`/`.comment-time-badge` now double as the spec's Anchor
  Chip component (brand-green pill), with timeline markers kept in a
  separate amber accent so "this is a positional marker" is never
  visually confused with "this is an active/brand state" on a busy
  timeline — a deliberate addition outside the spec's core palette,
  called out rather than silently introduced.
- **`app.html`, `workspace.html`, `media.html`** — wrapped in the new
  Sidebar + Top Bar shell; existing IDs/behavior inside are unchanged.
  Added a small sidebar account-initials chip (reuses the existing
  `initials()` helper from `shared.js`, no new backend call).
- **`login.html`, `index.html`, `auth-callback.html`, `review.html`,
  `review-media.html`** — restyled with the new tokens; guest/pre-auth
  pages use `.shell-card` alone (no sidebar — there's nothing to
  navigate to before signing in or as a one-workspace guest).
- **Found and fixed while doing this**: `workspace.html` had duplicate,
  dead `<dialog id="share-dialog">` markup and a `paintShareStatus()`
  function that were never actually used — `share-dialog.js` creates its
  own dialog element dynamically and always has. Introduced by me
  mid-rewrite, caught before finishing, removed — noting it because it's
  the kind of thing worth being upfront about rather than leaving
  unmentioned.
- Fixed several inline styles that referenced now-renamed CSS variables
  (`var(--danger)`, `var(--muted)`, etc.) which would have silently
  resolved to nothing — swept the whole `public/` tree for these after
  the rename and confirmed zero remain.

### What the spec asked for that I didn't build

- **Stat Card Row** (workspace count, "comments this week", pending
  invites) on the workspace list — the current API doesn't return this
  data (the workspace list endpoint returns basic fields only; per-
  workspace comment/media counts aren't included), and the brief
  explicitly said not to modify `server.js`. Fabricating these numbers
  client-side would mean either wrong data or N+1 API calls per
  workspace on every dashboard load. Left out rather than faked.
- Sidebar nav items for "Shared with me" / "Settings" — these aren't
  real destinations in the app (no such pages/routes exist). Added only
  the one real nav item (Workspaces) rather than linking to nothing.

### Verification

`npm test` — 37/37 passing, unchanged (this was a styling pass; no
backend logic touched). `node --check` clean on every JS file and every
HTML file's inline script. Boot-tested the full route set including the
new `/css/tokens.css` static file. Confirmed responsive behavior via the
CSS itself: `.review-layout` stacks below 960px (player above, comments
below, matching the spec's "~900px" target), `.app-shell`'s sidebar
switches to a horizontal strip below 640px rather than staying a cramped
vertical column. Could not visually screenshot this from the sandbox —
recommend a manual pass across both themes and a few breakpoints before
calling it done.

## Audit pass 11 — premium visual pass (glassmorphism, stat row, real dashboard data)

### Two mismatches flagged up front, not silently worked around

- **No React/Next.js/Vue, no Tailwind.** The request assumed a framework
  stack; this is a zero-dependency plain HTML/CSS/JS app by deliberate
  design (no build step, nothing to break on deploy). Delivered the same
  visual outcome as plain CSS instead of introducing build tooling that
  would change the project's actual architecture.
- **No "Pending Invites" stat card.** This app has no user-invite system
  — sharing is public-link + guest-identity based, not invite-a-teammate.
  There's no data behind that number at all. Per the brief's own rule
  ("no fake or hardcoded numbers," "only if already supported by current
  data"), this card doesn't exist rather than showing a permanent fake
  zero.

### Real dynamic stat row — the only backend change in this pass

`GET /api/stats` (new, `server.js`) returns `totalWorkspaces`,
`totalPublicLinks`, `totalComments` — two queries total regardless of
workspace count (not N+1): the caller's workspaces, then the `id` column
of every comment across all of them, tallied server-side. No new tables
or columns; every query is the same RLS-scoped read pattern already used
everywhere else, so a user still never sees more than they already could.
`totalWorkspaces`/`totalPublicLinks` reuse data the dashboard already had
in hand from `/api/workspaces` — only `totalComments` genuinely needed
new data, which is the only reason this endpoint exists.

### Visual system — extends, doesn't replace, last pass's tokens

- **`public/css/tokens.css`** — added glass/glow tokens (`--glass-bg`,
  `--glass-border`, `--glow-brand`, `--orb-1`/`--orb-2`) to both the
  light and dark blocks, plus a `--radius-3xl` tier and `--shadow-lg`.
  Deepened the dark palette toward the reference images' emerald tone.
- **`public/styles.css`** — decorative background (soft gradient orbs,
  `position: fixed; z-index: -1; pointer-events: none`, so they can
  never sit above or block anything, and a dotted-field pattern used
  only on the landing page hero); glass treatment on the outer app
  shell, workspace/media cards, the comment composer and cards, and
  every dialog; dashed separators between comment threads; pill-shaped
  composer submit buttons. Same class names throughout — verified by
  diff below, every interactive JS file is untouched.
- **`app.html`** — added the Stat Card Row (3 real cards) and a
  time-of-day greeting using the display name already returned by
  `/api/session`. Workspace cards now show a "Public"/nothing badge
  using `share_enabled`, already present in the existing
  `/api/workspaces` response — no new data needed for that one.
- **`workspace.html`** — added a Public/Private status badge next to the
  title, same data source as above.
- **`index.html`** — decorative dotfield background, three feature cards
  describing what the product actually does (frame-accurate comments,
  frictionless guest sharing, stays in Drive) rather than the reference
  images' AI-agent framing, which doesn't describe this product and
  would have been fabricated marketing copy.

### Verified untouched (confirmed by diff, not asserted)

- `lib/*.js` — byte-identical
- `supabase/*.sql` — byte-identical, no schema change
- `public/js/player.js`, `guest-identity.js`, `share-dialog.js`,
  `shared.js` — byte-identical. Comment creation, replies, threading,
  editing, deleting, timestamps, mentions-equivalent anchor chips, the
  whole share/guest flow: same code, same behavior, only restyled.
- `server.js` — the only change is the isolated `handleStats` function
  and its one route registration; diffed against the pre-pass version to
  confirm nothing else moved.

Test count unchanged at 37/37 (this pass added one new backend endpoint
that's integration-style, consistent with how the existing workspace/
media handlers are tested — via the boot/routing smoke test rather than
a unit test, since it's a thin wrapper around `pg()` calls with no pure
logic to isolate). Verified via `node --check` on every file, full test
suite, and a boot/routing smoke test including the new `/api/stats`
route's auth-gating. Same caveat as the last visual pass: I can't
screenshot this from the sandbox — a manual pass across both themes is
still the right next step before calling it done.

## Audit pass 12 — high-fidelity pass against the reference screenshots

The 3 reference images were screenshots of this app's own prior redesign
(previous pass), so this was a precision/fidelity pass on existing work,
not a new direction — closing the gaps between what I'd built and what
you actually see running.

### Grid background — the most visible gap, fixed

Previous pass used soft gradient orbs plus a dotted field confined to
the landing page hero. The references show one consistent fine square
*line* grid across every page. Replaced with a real grid
(`repeating` 1px lines forming 32px squares via `--grid-line`, themed for
light/dark) applied globally via `body`, with the gradient orbs layered
underneath for depth — matches the references directly instead of
approximating them.

### Consistent icon system — replaces emoji everywhere

Emoji render inconsistently across OS/browser and don't read as one
design system, which is what the references' clean line icons actually
are. Added a small reusable icon set to `public/js/shared.js`
(`icon(name, opts)` — pure function, exports currentColor SVG strings)
covering folder, link, chat, video/image/music, share, sync, sun/moon,
dots, trash, sparkle, and checkmark. Applied it to every sidebar icon,
theme toggle, stat card, media-kind fallback icon, and button across
every page. `player.js`/`guest-identity.js`/`share-dialog.js` — still
untouched (confirmed by diff below); none of them render these icons.

### Decorative elements matching the references specifically

- Sparkle accent next to the dashboard greeting name and a landing-page
  feature card corner — restrained, matches the references' sparing use
  rather than scattering it everywhere.
- A decorative squiggle-and-dot under each stat card's number — visual
  only, explicitly not pretending to be a real chart, since the app
  doesn't track stats over time.
- Floating decorative icon bubbles around the landing hero (chat, link,
  sync, folder) — hidden below 768px so they can't overlap the centered
  hero text on narrow screens.
- Feature cards on the landing page now include the reference's
  3-item checklist pattern with checkmark icons.

### A genuinely functional addition, not a fake button

The references show a 3-dot menu on workspace cards. Rather than add a
decorative dropdown with nothing behind it (the brief explicitly said
not to), wired it to the workspace deletion that already existed
(`DELETE /api/workspaces/:id`, previously only reachable from inside a
workspace's danger zone) — same confirm dialog, same endpoint, now also
reachable from the dashboard list. Deliberately **did not** add an
equivalent menu on individual media cards on the workspace page — there's
no backend action to attach to it (no per-file delete/rename endpoint
exists), and adding a dead dropdown there would be exactly the kind of
non-functional UI the brief said to avoid.

### A click-target bug caught and fixed before finishing

Restructuring workspace cards to fit an icon + a menu button meant the
whole card was no longer a single `<a>` — introduced a version where
only the inner text was clickable and the card's padding became dead
space. Caught it, moved the padding onto the inner link so the entire
card stays clickable with the menu overlaid on top, verified by reading
the rendered structure back rather than assuming the fix worked.

### Verified untouched (by diff, not by claim)

`lib/*.js`, `supabase/*.sql`, `public/js/player.js`, `guest-identity.js`,
`share-dialog.js` — byte-identical to before this pass. `server.js` diff
shows only the `/api/stats` endpoint from the *previous* pass — nothing
new touched it this time; this was a pure visual/markup pass.

Test count unchanged, 37/37. Verified via `node --check` on every file,
full test suite, and a boot/routing smoke test. Same standing caveat as
every visual pass: I can't screenshot this from the sandbox to compare
side-by-side against your references pixel-for-pixel — a manual
comparison pass is the honest next step, especially the grid spacing/
opacity and dark mode, which are the two things most likely to look
different on a real screen than in my head.
