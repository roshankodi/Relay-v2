import { test } from 'node:test';
import assert from 'node:assert/strict';

test('profile join batches by unique author_id and matches shape of a PostgREST embed', async t => {
  const originalFetch = globalThis.fetch;
  const seenUrls = [];

  globalThis.fetch = async url => {
    seenUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { id: 'user-1', display_name: 'Alice', avatar_url: null },
          { id: 'user-2', display_name: 'Bob', avatar_url: 'https://example.com/b.png' },
        ]),
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://placeholder.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'placeholder';
  const { pg } = await import('../lib/supabase.js');

  const rows = [
    { id: 'c1', author_id: 'user-1', body: 'hi' },
    { id: 'c2', author_id: 'user-2', body: 'hey' },
    { id: 'c3', author_id: 'user-1', body: 'again' }, // duplicate author on purpose
  ];
  const ids = [...new Set(rows.map(r => r.author_id))];
  const profiles = await pg('profiles', { token: 'tok', query: { select: 'id,display_name,avatar_url', id: `in.(${ids.join(',')})` } });
  const byId = new Map(profiles.map(p => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]));
  const joined = rows.map(r => ({ ...r, profiles: byId.get(r.author_id) ?? null }));

  assert.equal(joined[0].profiles.display_name, 'Alice');
  assert.equal(joined[1].profiles.display_name, 'Bob');
  assert.equal(joined[2].profiles.display_name, 'Alice');
  // Only one request should have gone out despite 3 rows / 2 unique authors.
  assert.equal(seenUrls.length, 1);
  assert.match(seenUrls[0], /id=in\.%28user-1%2Cuser-2%29/);
});
