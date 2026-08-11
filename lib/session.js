import { parseCookies, serializeCookie, clearCookie } from './cookies.js';
import { getUser, refreshSession } from './supabase.js';

const isProd = process.env.NODE_ENV === 'production';

export function setSessionCookies(res, session) {
  const opts = { secure: isProd, maxAge: session.expires_in ?? 3600 };
  res.setHeader('Set-Cookie', [
    serializeCookie('sb_at', session.access_token, opts),
    serializeCookie('sb_rt', session.refresh_token, { secure: isProd, maxAge: 60 * 60 * 24 * 30 }),
  ]);
}

export function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [clearCookie('sb_at', { secure: isProd }), clearCookie('sb_rt', { secure: isProd })]);
}

// Supabase rotates the refresh token on every use — the old one is
// invalidated the instant a new one is issued. If two requests race in
// with the same expired access token cookie, both would otherwise try to
// redeem the same (already-consumed) refresh token and one would fail,
// which looks like a random logout. De-duplicating in-flight refreshes
// for the same token means concurrent requests share one outcome instead
// of racing each other. This works because the app runs as a single
// persistent process — it would need a shared store (Redis) instead if
// ever run as multiple instances/processes.
const inFlightRefresh = new Map();

function refreshOnce(refreshToken) {
  if (inFlightRefresh.has(refreshToken)) return inFlightRefresh.get(refreshToken);
  const p = refreshSession(refreshToken).finally(() => inFlightRefresh.delete(refreshToken));
  inFlightRefresh.set(refreshToken, p);
  return p;
}

/**
 * Resolves the current user from cookies. Transparently refreshes an
 * expired access token using the refresh token cookie; if it refreshed,
 * the new cookies are attached to `res` automatically.
 * Returns { user, token } or null if there is no valid session.
 */
export async function getSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sb_at) {
    const user = await getUser(cookies.sb_at);
    if (user && !user.error) return { user, token: cookies.sb_at };
  }
  if (cookies.sb_rt) {
    try {
      const session = await refreshOnce(cookies.sb_rt);
      const user = await getUser(session.access_token);
      if (user && !user.error) {
        if (res) setSessionCookies(res, session);
        return { user, token: session.access_token };
      }
    } catch {
      // fall through to null below
    }
  }
  return null;
}
