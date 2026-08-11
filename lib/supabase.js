const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.warn('[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.');
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export class SupabaseApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SupabaseApiError';
    this.status = status;
  }
}

// ---- Auth (GoTrue) ----------------------------------------------------

export async function signUp({ email, password, fullName }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, data: fullName ? { full_name: fullName } : undefined }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new SupabaseApiError(data?.msg || data?.error_description || data?.message || 'Sign up failed', res.status);
  return data; // { user, session } — session is null if email confirmation is required
}

export async function signInWithPassword({ email, password }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new SupabaseApiError(data?.error_description || data?.msg || 'Invalid email or password', res.status);
  return data; // { access_token, refresh_token, expires_in, user }
}

export async function refreshSession(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new SupabaseApiError('Session expired', res.status);
  return data;
}

export async function getUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return parseJson(res);
}

export async function signOut(accessToken) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

/**
 * Builds the URL to send a browser to for "Continue with Google". Supabase
 * handles the entire OAuth dance (Google consent screen, code exchange)
 * and redirects back to `redirectTo` with the session in the URL fragment
 * (`#access_token=...&refresh_token=...`) — never sent to any server, only
 * readable by the browser. The redirect target reads that fragment and
 * posts it to our own session endpoint (see /auth/callback in server.js).
 *
 * Requires the Google provider to be enabled under Authentication >
 * Providers in the Supabase dashboard, with its own Google Cloud OAuth
 * client configured there — that's dashboard/Google Cloud Console setup
 * this code can't perform on your behalf.
 */
export function googleAuthorizeUrl(redirectTo) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

// ---- PostgREST ----------------------------------------------------------

/**
 * Thin PostgREST wrapper. Always sent with the *user's* access token (never
 * a service role key) so every request is subject to the same Row Level
 * Security policies the database defines — the server never gets more
 * access than the signed-in user does.
 */
export async function pg(path, { method = 'GET', token, body, prefer, query, headers: extraHeaders } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extraHeaders,
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new SupabaseApiError(data?.message || data?.error || 'Database request failed', res.status);
  }
  return data;
}

/**
 * PostgREST access for guests — no user session exists, so this uses the
 * anon key as both the API key and the bearer token (Postgres resolves
 * this to the `anon` role, auth.uid() is null). Access is instead gated by
 * RLS policies that check the `x-relay-share-token` / `x-relay-guest-token`
 * headers set here — see supabase/migrations/0002_sharing_and_guests.sql
 * for exactly what those policies allow.
 */
export async function pgPublic(path, { method = 'GET', shareToken, guestToken, body, prefer, query } = {}) {
  const headers = {};
  if (shareToken) headers['x-relay-share-token'] = shareToken;
  if (guestToken) headers['x-relay-guest-token'] = guestToken;
  return pg(path, { method, token: ANON_KEY, body, prefer, query, headers });
}
