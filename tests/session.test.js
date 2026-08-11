import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession } from '../lib/session.js';

function fakeReq(cookieHeader) {
  return { headers: { cookie: cookieHeader } };
}

function fakeRes() {
  const headers = {};
  return { setHeader: (k, v) => (headers[k] = v), headers };
}

test('getSession de-duplicates concurrent refreshes of the same expired token', async t => {
  let refreshCalls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      const token = opts.headers.Authorization.replace('Bearer ', '');
      // Only the freshly-issued token is considered valid.
      const ok = token === 'new-access-token';
      return {
        ok,
        status: ok ? 200 : 401,
        text: async () => JSON.stringify(ok ? { id: 'user-1', email: 'a@b.com' } : { error: 'invalid' }),
      };
    }
    if (u.includes('grant_type=refresh_token')) {
      refreshCalls += 1;
      // Simulate real network latency so both calls are genuinely concurrent.
      await new Promise(r => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }),
      };
    }
    throw new Error(`Unexpected fetch: ${u}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const req = fakeReq('sb_at=expired-token; sb_rt=old-refresh-token');
  const [a, b] = await Promise.all([getSession(req, fakeRes()), getSession(req, fakeRes())]);

  assert.equal(refreshCalls, 1, 'both concurrent requests should share a single refresh call');
  assert.equal(a.user.id, 'user-1');
  assert.equal(b.user.id, 'user-1');
  assert.equal(a.token, 'new-access-token');
  assert.equal(b.token, 'new-access-token');
});
