import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, serializeCookie, clearCookie } from '../lib/cookies.js';

test('parseCookies splits multiple cookies', () => {
  const out = parseCookies('sb_at=abc123; sb_rt=def456; theme=dark');
  assert.equal(out.sb_at, 'abc123');
  assert.equal(out.sb_rt, 'def456');
  assert.equal(out.theme, 'dark');
});

test('parseCookies handles missing header', () => {
  assert.deepEqual(parseCookies(undefined), {});
});

test('parseCookies decodes URI-encoded values', () => {
  const out = parseCookies('token=' + encodeURIComponent('a b/c'));
  assert.equal(out.token, 'a b/c');
});

test('serializeCookie includes HttpOnly and SameSite by default', () => {
  const str = serializeCookie('sb_at', 'xyz', { maxAge: 3600 });
  assert.match(str, /HttpOnly/);
  assert.match(str, /SameSite=Lax/);
  assert.match(str, /Max-Age=3600/);
  assert.doesNotMatch(str, /Secure/);
});

test('serializeCookie adds Secure when requested', () => {
  const str = serializeCookie('sb_at', 'xyz', { secure: true });
  assert.match(str, /Secure/);
});

test('clearCookie sets Max-Age=0', () => {
  const str = clearCookie('sb_at');
  assert.match(str, /Max-Age=0/);
});
