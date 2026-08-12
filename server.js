import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

import { parseCookies } from './lib/cookies.js';
import { setSessionCookies, clearSessionCookies, getSession } from './lib/session.js';
import { signUp, signInWithPassword, signOut, pg, pgPublic, googleAuthorizeUrl, getUser, SupabaseApiError } from './lib/supabase.js';
import { folderIdFromUrl, scanPublicFolder, fetchDriveFile } from './lib/drive.js';
import { validateWorkspaceInput, validateCommentInput, validateGuestIdentity, isUuid, ValidationError } from './lib/validate.js';
import { rateLimit, clientKey } from './lib/ratelimit.js';
import { sanitizeComment, sanitizeComments } from './lib/comments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Columns intentionally excluded from every comment SELECT:
//   - guest_token: a capability secret proving guest comment ownership.
//     If this were ever returned to a client, anyone who can read a
//     comment could forge delete/edit rights over it. It is only ever
//     compared server-side (via RLS, using the request header the actual
//     owner presents) — never selected.
const COMMENT_COLUMNS = 'id,workspace_id,media_id,parent_id,author_id,guest_name,guest_email,guest_token,body,timestamp_ms,range_start_ms,range_end_ms,annotation,created_at,updated_at';
const WORKSPACE_COLUMNS = 'id,owner_id,name,description,drive_folder_id,drive_url,share_enabled,created_at,updated_at';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8' });
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new ValidationError('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}

/** Same-origin check for state-changing requests — basic CSRF hardening
 *  alongside the SameSite=Lax session cookies. Applies to every /api/
 *  write, authenticated or guest. */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests from older browsers may omit Origin
  const host = req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function siteOrigin(req) {
  // Trust a reverse proxy's word for it (Render, etc. set this correctly);
  // otherwise ask the actual connection, never an env var — a link's
  // scheme has to match how the server is really being reached, or a
  // copied link throws ERR_SSL_PROTOCOL_ERROR (https:// against a
  // plain-http dev server) or gets rejected as insecure (http:// against
  // a TLS-terminated deployment).
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

async function serveStatic(req, res, urlPath) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    send(res, 200, data, { 'content-type': MIME[ext] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

async function servePage(req, res, file, { auth = false } = {}) {
  if (auth) {
    const session = await getSession(req, res);
    if (!session) return send(res, 302, '', { Location: '/login' });
  }
  await serveStatic(req, res, `/${file}`);
}

function apiError(res, e, fallback, status = 400) {
  if (e instanceof ValidationError) return json(res, 422, { error: e.message });
  if (e instanceof SupabaseApiError) {
    console.error(fallback, e.status, e.message);
    if (e.status === 401 || e.status === 403) return json(res, 403, { error: 'Not allowed' });
    if (e.status === 409 || (e.message && e.message.includes('unique constraint'))) {
      return json(res, 409, { error: 'You have already added this Google Drive folder as a workspace.' });
    }
    return json(res, status, { error: e.message || fallback });
  }
  if (e?.message && e.message.includes('unique constraint')) {
    return json(res, 409, { error: 'You have already added this Google Drive folder as a workspace.' });
  }
  console.error(fallback, e);
  const userMessage = e?.message && !e.message.includes('object') ? e.message : fallback;
  return json(res, status, { error: userMessage });
}

async function requireApiUser(req, res) {
  const session = await getSession(req, res);
  if (!session) {
    json(res, 401, { error: 'Sign in required' });
    return null;
  }
  return session;
}

function newShareToken() {
  return crypto.randomBytes(24).toString('base64url'); // ~144 bits — not practically guessable
}

function newGuestToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Attaches { profiles: { display_name, avatar_url } } to each row for
// account-holder comments, matching the shape the frontend expects —
// mirrors what a PostgREST embed would have returned, without depending on
// a comments->profiles foreign key existing (there isn't one; both tables
// independently reference auth.users, so PostgREST can't auto-detect that
// relationship). Guest comments already carry their own guest_name.
async function attachProfiles(rows, pgFn, pgArgs) {
  const ids = [...new Set(rows.filter(r => r.author_id).map(r => r.author_id))];
  if (!ids.length) return rows;
  const profiles = await pgFn('profiles', { ...pgArgs, query: { select: 'id,display_name,avatar_url', id: `in.(${ids.join(',')})` } });
  const byId = new Map(profiles.map(p => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]));
  return rows.map(r => ({ ...r, profiles: r.author_id ? (byId.get(r.author_id) ?? null) : null }));
}

// ---------------------------------------------------------------------
// Auth route handlers
// ---------------------------------------------------------------------

async function handleSignup(req, res) {
  const body = await readBody(req);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length < 6) {
    return json(res, 422, { error: 'Enter a valid email and a password with at least 6 characters' });
  }
  if (fullName.length < 2) {
    return json(res, 422, { error: 'Enter your full name (at least 2 characters)' });
  }
  const data = await signUp({ email: body.email, password: body.password, fullName });
  if (data.session) {
    setSessionCookies(res, data.session);
    return json(res, 201, { user: data.user, profile: { display_name: fullName } });
  }
  return json(res, 201, { user: data.user, message: 'Check your email to confirm your account.' });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return json(res, 422, { error: 'Enter your email and password' });
  }
  const session = await signInWithPassword({ email: body.email, password: body.password });
  setSessionCookies(res, session);
  json(res, 200, { user: session.user });
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sb_at) await signOut(cookies.sb_at);
  clearSessionCookies(res);
  json(res, 200, { ok: true });
}

async function handleSession(req, res) {
  const session = await getSession(req, res);
  if (!session) return json(res, 401, { error: 'Not signed in' });
  const [profile] = await pg('profiles', { token: session.token, query: { select: 'display_name,avatar_url', id: `eq.${session.user.id}` } });
  json(res, 200, { user: session.user, profile: profile || null });
}

// Exchanges the tokens Supabase's OAuth redirect handed the browser (in
// the URL fragment, never sent to any server) for our own httpOnly session
// cookies. We re-verify the access token against GoTrue ourselves rather
// than trusting the client's word for it.
async function handleOAuthSession(req, res) {
  const body = await readBody(req);
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    return json(res, 422, { error: 'Invalid session data' });
  }
  const user = await getUser(body.access_token);
  if (!user || user.error) return json(res, 401, { error: 'Invalid session' });
  setSessionCookies(res, { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in });
  json(res, 200, { user });
}

// ---------------------------------------------------------------------
// Workspace handlers (account holders)
// ---------------------------------------------------------------------

async function handleListWorkspaces(req, res, session) {
  // RLS already restricts this to workspaces the user is a member of.
  const rows = await pg('workspaces', {
    token: session.token,
    query: { select: WORKSPACE_COLUMNS, order: 'created_at.desc' },
  });
  json(res, 200, rows.map(w => ({ ...w, isOwner: w.owner_id === session.user.id })));
}

/**
 * Dashboard stat row. Two queries regardless of workspace count (not
 * N+1): one for the caller's workspaces, one for the id column of every
 * comment across all of them. No new tables/columns — just reuses the
 * same RLS-scoped reads every other endpoint already does, so this
 * never sees more than the caller could already see one workspace at a
 * time.
 */
async function handleStats(req, res, session) {
  const workspaces = await pg('workspaces', { token: session.token, query: { select: 'id,share_enabled' } });
  const workspaceIds = workspaces.map(w => w.id);
  let totalComments = 0;
  if (workspaceIds.length) {
    const rows = await pg('comments', {
      token: session.token,
      query: { select: 'id', workspace_id: `in.(${workspaceIds.join(',')})` },
    });
    totalComments = rows.length;
  }
  json(res, 200, {
    totalWorkspaces: workspaces.length,
    totalPublicLinks: workspaces.filter(w => w.share_enabled).length,
    totalComments,
  });
}

async function handleCreateWorkspace(req, res, session) {
  if (!rateLimit(`workspace-create:${clientKey(req)}`, 10, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const input = validateWorkspaceInput(await readBody(req));
  const folderId = folderIdFromUrl(input.driveUrl);
  const [workspace] = await pg('workspaces', {
    method: 'POST',
    token: session.token,
    prefer: 'return=representation',
    query: { select: WORKSPACE_COLUMNS },
    body: {
      owner_id: session.user.id,
      name: input.name,
      description: input.description || null,
      drive_folder_id: folderId,
      drive_url: input.driveUrl,
    },
  });
  await pg('workspace_members', {
    method: 'POST',
    token: session.token,
    body: { workspace_id: workspace.id, user_id: session.user.id, role: 'owner' },
  });
  const files = await scanPublicFolder(folderId);
  if (files.length) {
    await pg('media', { method: 'POST', token: session.token, body: files.map(f => mediaRow(workspace.id, f)) });
  }
  json(res, 201, { ...workspace, isOwner: true });
}

function mediaRow(workspaceId, f, extra = {}) {
  return {
    workspace_id: workspaceId,
    drive_file_id: f.id,
    path: f.name,
    name: f.name.split('/').pop(),
    mime_type: f.mimeType,
    media_kind: f.kind,
    modified_at: f.modifiedTime ?? null,
    thumbnail_url: f.thumbnailLink ?? null,
    ...extra,
  };
}

async function handleGetWorkspace(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  const [workspace] = await pg('workspaces', { token: session.token, query: { select: WORKSPACE_COLUMNS, id: `eq.${id}` } });
  if (!workspace) return json(res, 404, { error: 'Not found' });
  const media = await pg('media', {
    token: session.token,
    query: { select: '*', workspace_id: `eq.${id}`, is_deleted: 'eq.false', order: 'path.asc' },
  });
  json(res, 200, { workspace: { ...workspace, isOwner: workspace.owner_id === session.user.id }, media });
}

async function handleSyncWorkspace(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  if (!rateLimit(`sync:${clientKey(req)}`, 6, 60_000)) {
    return json(res, 429, { error: 'Too many sync requests, try again shortly.' });
  }
  const [workspace] = await pg('workspaces', { token: session.token, query: { select: WORKSPACE_COLUMNS, id: `eq.${id}` } });
  if (!workspace || workspace.owner_id !== session.user.id) return json(res, 403, { error: 'Forbidden' });
  const files = await scanPublicFolder(workspace.drive_folder_id);
  const ids = files.map(f => f.id);
  const notInList = ids.length ? `(${ids.map(x => `"${x}"`).join(',')})` : '("")';
  await pg('media', {
    method: 'PATCH',
    token: session.token,
    query: { workspace_id: `eq.${id}`, drive_file_id: `not.in.${notInList}` },
    body: { is_deleted: true },
  });
  if (files.length) {
    await pg('media', {
      method: 'POST',
      token: session.token,
      prefer: 'resolution=merge-duplicates',
      query: { on_conflict: 'workspace_id,drive_file_id' },
      body: files.map(f => mediaRow(id, f, { is_deleted: false })),
    });
  }
  json(res, 200, { count: files.length });
}

async function handleDeleteWorkspace(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  // RLS ("workspace delete owner") only lets the owner's request affect
  // any rows; deleting the workspace row cascades (via existing foreign
  // keys) to workspace_members, media, and comments. This never touches
  // Google Drive — the app only ever stored references to Drive files,
  // never the files themselves.
  const deleted = await pg('workspaces', {
    method: 'DELETE',
    token: session.token,
    prefer: 'return=representation',
    query: { id: `eq.${id}` },
  });
  if (!deleted.length) return json(res, 404, { error: 'Not found' });
  json(res, 200, { id });
}

// ---- Sharing management (owner only) -----------------------------------

function shareUrl(req, token) {
  return `${siteOrigin(req)}/review/${token}`;
}

async function handleGetShare(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  const [workspace] = await pg('workspaces', {
    token: session.token,
    query: { select: 'owner_id,share_enabled,share_token', id: `eq.${id}` },
  });
  if (!workspace || workspace.owner_id !== session.user.id) return json(res, 403, { error: 'Forbidden' });
  json(res, 200, {
    shareEnabled: workspace.share_enabled,
    shareUrl: workspace.share_enabled && workspace.share_token ? shareUrl(req, workspace.share_token) : null,
  });
}

async function handleEnableShare(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  const token = newShareToken();
  const [workspace] = await pg('workspaces', {
    method: 'PATCH',
    token: session.token,
    prefer: 'return=representation',
    query: { id: `eq.${id}`, owner_id: `eq.${session.user.id}` },
    body: { share_enabled: true, share_token: token },
  });
  if (!workspace) return json(res, 403, { error: 'Forbidden' });
  json(res, 200, { shareEnabled: true, shareUrl: shareUrl(req, token) });
}

async function handleDisableShare(req, res, session, id) {
  if (!isUuid(id)) return json(res, 404, { error: 'Not found' });
  const [workspace] = await pg('workspaces', {
    method: 'PATCH',
    token: session.token,
    prefer: 'return=representation',
    query: { id: `eq.${id}`, owner_id: `eq.${session.user.id}` },
    body: { share_enabled: false, share_token: null },
  });
  if (!workspace) return json(res, 403, { error: 'Forbidden' });
  json(res, 200, { shareEnabled: false, shareUrl: null });
}

// ---------------------------------------------------------------------
// Media + comments (account holders)
// ---------------------------------------------------------------------

async function handleGetMedia(req, res, session, mediaId) {
  if (!isUuid(mediaId)) return json(res, 404, { error: 'Not found' });
  const [media] = await pg('media', { token: session.token, query: { select: '*', id: `eq.${mediaId}` } });
  if (!media) return json(res, 404, { error: 'Not found' });
  const [workspace] = await pg('workspaces', { token: session.token, query: { select: 'id,owner_id', id: `eq.${media.workspace_id}` } });
  const isOwner = workspace?.owner_id === session.user.id;
  const rawComments = await pg('comments', {
    token: session.token,
    query: { select: COMMENT_COLUMNS, media_id: `eq.${mediaId}`, order: 'created_at.asc' },
  });
  const withProfiles = await attachProfiles(rawComments, pg, { token: session.token });
  const comments = sanitizeComments(withProfiles, { userId: session.user.id, isWorkspaceOwner: isOwner });
  json(res, 200, { media: { ...media, workspaceIsOwner: isOwner }, comments, previewUrl: `/api/media/${mediaId}/file` });
}

/**
 * Streams the actual file bytes for a media item through our own server —
 * see fetchDriveFile() for why this replaced a direct Drive download link.
 * Access is gated the same way every other media read is: the RLS-scoped
 * lookup below returns nothing (404) unless the caller is a member of the
 * file's workspace, so this never becomes an open proxy for arbitrary
 * Drive file IDs.
 */
async function streamMediaFile(req, res, media) {
  let upstream;
  try {
    upstream = await fetchDriveFile(media.drive_file_id, req.headers.range);
  } catch (e) {
    console.error('Drive file fetch failed', e);
    return send(res, 502, 'Unable to reach Google Drive');
  }
  if (!upstream.ok && upstream.status !== 206) {
    return send(res, upstream.status === 404 ? 404 : 502, 'File unavailable');
  }
  const headers = { ...SECURITY_HEADERS, 'Content-Type': media.mime_type, 'Accept-Ranges': 'bytes' };
  const len = upstream.headers.get('content-length');
  const range = upstream.headers.get('content-range');
  if (len) headers['Content-Length'] = len;
  if (range) headers['Content-Range'] = range;
  headers['Cache-Control'] = 'private, max-age=3600';
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function handleMediaFile(req, res, session, mediaId) {
  if (!isUuid(mediaId)) return json(res, 404, { error: 'Not found' });
  if (!rateLimit(`media-file:${clientKey(req)}`, 120, 60_000)) {
    return send(res, 429, 'Too many requests, slow down.');
  }
  let media;
  try {
    [media] = await pg('media', { token: session.token, query: { select: 'drive_file_id,mime_type', id: `eq.${mediaId}` } });
  } catch (e) {
    return apiError(res, e, 'Unable to load media', 500);
  }
  if (!media) return send(res, 404, 'Not found');
  await streamMediaFile(req, res, media);
}

/**
 * Validates a reply's parentId the same way handleCreateComment already
 * validates mediaId: look the row up under RLS/share-token access rather
 * than trusting the client, so a reply can't be attached to a comment on
 * different media (or a workspace the caller can't even see). Also
 * enforces single-level threading — replying to a reply is rejected
 * rather than silently nested, keeping "replies render directly below
 * their parent" true without needing recursive rendering.
 */
async function resolveParentComment(pgFn, pgArgs, parentId, mediaId) {
  const [parent] = await pgFn('comments', { ...pgArgs, query: { select: 'id,media_id,parent_id', id: `eq.${parentId}` } });
  if (!parent || parent.media_id !== mediaId) throw new ValidationError('Invalid parent comment');
  if (parent.parent_id) throw new ValidationError('Cannot reply to a reply');
  return parent;
}

async function handleCreateComment(req, res, session) {
  if (!rateLimit(`comment:${clientKey(req)}`, 30, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const raw = await readBody(req);
  if (!isUuid(raw.mediaId)) return json(res, 422, { error: 'Invalid request' });
  const input = validateCommentInput(raw);
  // Look up the media row's real workspace_id under RLS rather than trusting
  // the client-supplied workspaceId — otherwise a member of workspace A could
  // attach a comment to media that actually belongs to workspace B.
  const [media] = await pg('media', { token: session.token, query: { select: 'workspace_id', id: `eq.${raw.mediaId}` } });
  if (!media) return json(res, 404, { error: 'Not found' });
  if (input.parentId) await resolveParentComment(pg, { token: session.token }, input.parentId, raw.mediaId);
  const [comment] = await pg('comments', {
    method: 'POST',
    token: session.token,
    prefer: 'return=representation',
    query: { select: COMMENT_COLUMNS },
    body: {
      workspace_id: media.workspace_id,
      media_id: raw.mediaId,
      parent_id: input.parentId,
      author_id: session.user.id,
      body: input.body,
      timestamp_ms: input.timestampMs ?? null,
      range_start_ms: input.rangeStartMs ?? null,
      range_end_ms: input.rangeEndMs ?? null,
      annotation: input.annotation,
    },
  });
  const [withProfile] = await attachProfiles([comment], pg, { token: session.token });
  json(res, 201, sanitizeComment(withProfile, { userId: session.user.id, isWorkspaceOwner: false }));
}

async function handleEditComment(req, res, session, commentId) {
  if (!isUuid(commentId)) return json(res, 404, { error: 'Not found' });
  if (!rateLimit(`comment-edit:${clientKey(req)}`, 30, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const raw = await readBody(req);
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body || body.length > 5000) return json(res, 422, { error: 'Comment must be 1-5000 characters' });
  // RLS ("comments update own") only allows this to affect a row the
  // caller authored themselves — editing is always self-only, unlike
  // delete, where the workspace owner can also moderate.
  const updated = await pg('comments', {
    method: 'PATCH',
    token: session.token,
    prefer: 'return=representation',
    query: { id: `eq.${commentId}`, select: COMMENT_COLUMNS },
    body: { body, updated_at: new Date().toISOString() },
  });
  if (!updated.length) return json(res, 404, { error: 'Not found' });
  const [withProfile] = await attachProfiles(updated, pg, { token: session.token });
  json(res, 200, sanitizeComment(withProfile, { userId: session.user.id, isWorkspaceOwner: false }));
}

async function handleDeleteComment(req, res, session, commentId) {
  if (!isUuid(commentId)) return json(res, 404, { error: 'Not found' });
  if (!rateLimit(`comment-delete:${clientKey(req)}`, 30, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  // RLS ("comments delete own" / "comments delete owner") only allows a
  // row to be deleted by its author or the workspace owner — this simply
  // affects zero rows otherwise rather than erroring.
  const deleted = await pg('comments', {
    method: 'DELETE',
    token: session.token,
    prefer: 'return=representation',
    query: { id: `eq.${commentId}` },
  });
  if (!deleted.length) return json(res, 404, { error: 'Not found' });
  json(res, 200, { id: commentId });
}

// ---------------------------------------------------------------------
// Public (guest) handlers — no account, gated by share token + guest token
// ---------------------------------------------------------------------

async function resolveShareToken(req, res, token) {
  if (!rateLimit(`public-read:${clientKey(req)}`, 90, 60_000)) {
    json(res, 429, { error: 'Too many requests, slow down.' });
    return null;
  }
  const [workspace] = await pgPublic('workspaces', {
    shareToken: token,
    query: { select: WORKSPACE_COLUMNS, share_token: `eq.${token}` },
  });
  if (!workspace) {
    json(res, 404, { error: 'This share link is invalid or sharing has been turned off.' });
    return null;
  }
  return workspace;
}

async function handlePublicWorkspace(req, res, token) {
  const workspace = await resolveShareToken(req, res, token);
  if (!workspace) return;
  const media = await pgPublic('media', {
    shareToken: token,
    query: { select: '*', workspace_id: `eq.${workspace.id}`, is_deleted: 'eq.false', order: 'path.asc' },
  });
  json(res, 200, { workspace, media });
}

async function handlePublicMedia(req, res, token, mediaId) {
  if (!isUuid(mediaId)) return json(res, 404, { error: 'Not found' });
  const workspace = await resolveShareToken(req, res, token);
  if (!workspace) return;
  const [media] = await pgPublic('media', { shareToken: token, query: { select: '*', id: `eq.${mediaId}`, workspace_id: `eq.${workspace.id}` } });
  if (!media) return json(res, 404, { error: 'Not found' });
  const rawComments = await pgPublic('comments', {
    shareToken: token,
    query: { select: COMMENT_COLUMNS, media_id: `eq.${mediaId}`, order: 'created_at.asc' },
  });
  const withProfiles = await attachProfiles(rawComments, pgPublic, { shareToken: token });
  const guestToken = req.headers['x-relay-guest-token'];
  const comments = sanitizeComments(withProfiles, { guestToken, isWorkspaceOwner: false });
  json(res, 200, { media, comments, previewUrl: `/api/public/${token}/media/${mediaId}/file` });
}

async function handlePublicMediaFile(req, res, token, mediaId) {
  if (!isUuid(mediaId)) return json(res, 404, { error: 'Not found' });
  if (!rateLimit(`public-file:${clientKey(req)}`, 120, 60_000)) return send(res, 429, 'Too many requests, slow down.');
  const [workspace] = await pgPublic('workspaces', { shareToken: token, query: { select: 'id', share_token: `eq.${token}` } });
  if (!workspace) return send(res, 404, 'Not found');
  const [media] = await pgPublic('media', {
    shareToken: token,
    query: { select: 'drive_file_id,mime_type', id: `eq.${mediaId}`, workspace_id: `eq.${workspace.id}` },
  });
  if (!media) return send(res, 404, 'Not found');
  await streamMediaFile(req, res, media);
}

async function handlePublicCreateComment(req, res, token) {
  if (!rateLimit(`public-comment:${clientKey(req)}`, 20, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const raw = await readBody(req);
  if (!isUuid(raw.mediaId)) return json(res, 422, { error: 'Invalid request' });
  const guest = validateGuestIdentity(raw);
  const input = validateCommentInput(raw);
  const workspace = await resolveShareToken(req, res, token);
  if (!workspace) return;
  const [media] = await pgPublic('media', { shareToken: token, query: { select: 'id', id: `eq.${raw.mediaId}`, workspace_id: `eq.${workspace.id}` } });
  if (!media) return json(res, 404, { error: 'Not found' });
  if (input.parentId) await resolveParentComment(pgPublic, { shareToken: token }, input.parentId, raw.mediaId);
  const [comment] = await pgPublic('comments', {
    method: 'POST',
    shareToken: token,
    prefer: 'return=representation',
    query: { select: COMMENT_COLUMNS },
    body: {
      workspace_id: workspace.id,
      media_id: raw.mediaId,
      parent_id: input.parentId,
      guest_name: guest.name,
      guest_email: guest.email,
      guest_token: guest.token,
      body: input.body,
      timestamp_ms: input.timestampMs ?? null,
      range_start_ms: input.rangeStartMs ?? null,
      range_end_ms: input.rangeEndMs ?? null,
      annotation: input.annotation,
    },
  });
  json(res, 201, sanitizeComment({ ...comment, profiles: null }, { guestToken: guest.token, isWorkspaceOwner: false }));
}

async function handlePublicEditComment(req, res, token, commentId, guestToken) {
  if (!isUuid(commentId)) return json(res, 404, { error: 'Not found' });
  if (!guestToken) return json(res, 403, { error: 'Not allowed' });
  if (!rateLimit(`public-comment-edit:${clientKey(req)}`, 20, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const raw = await readBody(req);
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body || body.length > 5000) return json(res, 422, { error: 'Comment must be 1-5000 characters' });
  const updated = await pgPublic('comments', {
    method: 'PATCH',
    shareToken: token,
    guestToken,
    prefer: 'return=representation',
    query: { id: `eq.${commentId}`, select: COMMENT_COLUMNS },
    body: { body, updated_at: new Date().toISOString() },
  });
  if (!updated.length) return json(res, 404, { error: 'Not found' });
  json(res, 200, sanitizeComment({ ...updated[0], profiles: null }, { guestToken, isWorkspaceOwner: false }));
}

async function handlePublicDeleteComment(req, res, token, commentId, guestToken) {
  if (!isUuid(commentId)) return json(res, 404, { error: 'Not found' });
  if (!guestToken) return json(res, 403, { error: 'Not allowed' });
  if (!rateLimit(`public-comment-delete:${clientKey(req)}`, 20, 60_000)) {
    return json(res, 429, { error: 'Too many requests, slow down.' });
  }
  const deleted = await pgPublic('comments', {
    method: 'DELETE',
    shareToken: token,
    guestToken,
    prefer: 'return=representation',
    query: { id: `eq.${commentId}` },
  });
  if (!deleted.length) return json(res, 404, { error: 'Not found' });
  json(res, 200, { id: commentId });
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  const method = req.method;

  try {
    // ---- Pages ----
    if (method === 'GET' && pathname === '/') return servePage(req, res, 'index.html');
    if (method === 'GET' && pathname === '/login') return servePage(req, res, 'login.html');
    if (method === 'GET' && pathname === '/auth/callback') return servePage(req, res, 'auth-callback.html');
    if (method === 'GET' && pathname === '/auth/google') {
      return send(res, 302, '', { Location: googleAuthorizeUrl(`${siteOrigin(req)}/auth/callback`) });
    }
    if (method === 'GET' && pathname === '/app') return servePage(req, res, 'app.html', { auth: true });
    if (method === 'GET' && /^\/app\/workspaces\/[^/]+$/.test(pathname))
      return servePage(req, res, 'workspace.html', { auth: true });
    if (method === 'GET' && /^\/app\/workspaces\/[^/]+\/media\/[^/]+$/.test(pathname))
      return servePage(req, res, 'media.html', { auth: true });
    if (method === 'GET' && /^\/review\/[^/]+$/.test(pathname)) return servePage(req, res, 'review.html');
    if (method === 'GET' && /^\/review\/[^/]+\/media\/[^/]+$/.test(pathname)) return servePage(req, res, 'review-media.html');

    // ---- Auth API ----
    if (method === 'POST' && pathname === '/api/auth/signup') {
      if (!isSameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
      if (!rateLimit(`signup:${clientKey(req)}`, 5, 60_000)) return json(res, 429, { error: 'Too many attempts, try again shortly.' });
      return await handleSignup(req, res).catch(e => apiError(res, e, 'Unable to sign up'));
    }
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (!isSameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
      if (!rateLimit(`login:${clientKey(req)}`, 10, 60_000)) return json(res, 429, { error: 'Too many attempts, try again shortly.' });
      return await handleLogin(req, res).catch(e => apiError(res, e, 'Invalid email or password', 401));
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      return await handleLogout(req, res).catch(e => apiError(res, e, 'Unable to sign out'));
    }
    if (method === 'POST' && pathname === '/api/auth/oauth-session') {
      if (!isSameOrigin(req)) return json(res, 403, { error: 'Forbidden' });
      return await handleOAuthSession(req, res).catch(e => apiError(res, e, 'Unable to complete sign-in', 401));
    }
    if (method === 'GET' && pathname === '/api/session') {
      return await handleSession(req, res).catch(e => apiError(res, e, 'Unable to load session', 500));
    }

    // ---- Public (guest) API — no account, gated by share token ----
    if (pathname.startsWith('/api/public/')) {
      if (['POST', 'PATCH', 'DELETE'].includes(method) && !isSameOrigin(req)) {
        return json(res, 403, { error: 'Forbidden' });
      }
      const guestToken = req.headers['x-relay-guest-token'];

      let m = pathname.match(/^\/api\/public\/([^/]+)$/);
      if (m && method === 'GET') return await handlePublicWorkspace(req, res, m[1]).catch(e => apiError(res, e, 'Unable to load workspace', 500));

      m = pathname.match(/^\/api\/public\/([^/]+)\/media\/([^/]+)$/);
      if (m && method === 'GET') return await handlePublicMedia(req, res, m[1], m[2]).catch(e => apiError(res, e, 'Unable to load media', 500));

      m = pathname.match(/^\/api\/public\/([^/]+)\/media\/([^/]+)\/file$/);
      if (m && method === 'GET') return await handlePublicMediaFile(req, res, m[1], m[2]);

      m = pathname.match(/^\/api\/public\/([^/]+)\/comments$/);
      if (m && method === 'POST') return await handlePublicCreateComment(req, res, m[1]).catch(e => apiError(res, e, 'Unable to add comment'));

      m = pathname.match(/^\/api\/public\/([^/]+)\/comments\/([^/]+)$/);
      if (m && method === 'PATCH') return await handlePublicEditComment(req, res, m[1], m[2], guestToken).catch(e => apiError(res, e, 'Unable to edit comment'));
      if (m && method === 'DELETE') return await handlePublicDeleteComment(req, res, m[1], m[2], guestToken).catch(e => apiError(res, e, 'Unable to delete comment'));

      return json(res, 404, { error: 'Not found' });
    }

    // ---- Everything else under /api/ requires a signed-in user ----
    if (pathname.startsWith('/api/')) {
      if (['POST', 'PATCH', 'DELETE'].includes(method) && !isSameOrigin(req)) {
        return json(res, 403, { error: 'Forbidden' });
      }
      const session = await requireApiUser(req, res);
      if (!session) return; // response already sent

      if (method === 'GET' && pathname === '/api/stats')
        return await handleStats(req, res, session).catch(e => apiError(res, e, 'Unable to load stats', 500));

      if (method === 'GET' && pathname === '/api/workspaces')
        return await handleListWorkspaces(req, res, session).catch(e => apiError(res, e, 'Unable to load workspaces', 500));
      if (method === 'POST' && pathname === '/api/workspaces')
        return await handleCreateWorkspace(req, res, session).catch(e => apiError(res, e, 'Unable to create workspace'));

      let m = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
      if (m && method === 'GET') return await handleGetWorkspace(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to load workspace', 500));
      if (m && method === 'DELETE') return await handleDeleteWorkspace(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to delete workspace'));

      m = pathname.match(/^\/api\/workspaces\/([^/]+)\/sync$/);
      if (m && method === 'POST') return await handleSyncWorkspace(req, res, session, m[1]).catch(e => apiError(res, e, 'Sync failed'));

      m = pathname.match(/^\/api\/workspaces\/([^/]+)\/share$/);
      if (m && method === 'GET') return await handleGetShare(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to load sharing status', 500));
      if (m && method === 'POST') return await handleEnableShare(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to enable sharing'));
      if (m && method === 'DELETE') return await handleDisableShare(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to disable sharing'));

      m = pathname.match(/^\/api\/media\/([^/]+)$/);
      if (m && method === 'GET') return await handleGetMedia(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to load media', 500));

      m = pathname.match(/^\/api\/media\/([^/]+)\/file$/);
      if (m && method === 'GET') return await handleMediaFile(req, res, session, m[1]);

      if (method === 'POST' && pathname === '/api/comments')
        return await handleCreateComment(req, res, session).catch(e => apiError(res, e, 'Unable to add comment'));

      m = pathname.match(/^\/api\/comments\/([^/]+)$/);
      if (m && method === 'PATCH') return await handleEditComment(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to edit comment'));
      if (m && method === 'DELETE') return await handleDeleteComment(req, res, session, m[1]).catch(e => apiError(res, e, 'Unable to delete comment'));

      return json(res, 404, { error: 'Not found' });
    }

    if (method === 'GET' && pathname === '/favicon.ico') return send(res, 204, '');

    // ---- Static assets ----
    if (method === 'GET') return serveStatic(req, res, pathname);

    send(res, 405, 'Method not allowed');
  } catch (e) {
    console.error('Unhandled error', e);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong' });
  }
}

const server = http.createServer(handler);

if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Relay listening on http://localhost:${PORT}`);
  });
}
