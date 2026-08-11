import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage shim so this runs under plain Node,
// regardless of whether the current Node version exposes a global one.
function installLocalStorageShim() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

test('a freshly generated guest token is within the server\'s 16-64 char bound', async () => {
  installLocalStorageShim();
  const { setGuestIdentity } = await import('../public/js/shared.js');
  const identity = setGuestIdentity('Jamie Rivera', 'jamie@example.com');
  assert.ok(identity.token.length >= 16 && identity.token.length <= 64, `token length was ${identity.token.length}`);
  // URL/header-safe: base64url alphabet only.
  assert.match(identity.token, /^[A-Za-z0-9_-]+$/);
});

test('re-saving the same identity keeps the same (valid) token', async () => {
  installLocalStorageShim();
  const { setGuestIdentity } = await import('../public/js/shared.js');
  const first = setGuestIdentity('Jamie', 'jamie@example.com');
  const second = setGuestIdentity('Jamie R.', 'jamie@example.com');
  assert.equal(first.token, second.token);
});

test('a corrupted 72-char legacy token (the original bug) self-heals to a valid one', async () => {
  const store = installLocalStorageShim();
  store.set('relay_guest_identity', JSON.stringify({ name: 'Jamie', email: 'jamie@example.com', token: 'a'.repeat(72) }));
  const { getGuestIdentity, setGuestIdentity } = await import('../public/js/shared.js?t=' + Date.now());
  // Reading it directly should not return the invalid token.
  assert.equal(getGuestIdentity(), null);
  // And using the identity flow regenerates a valid one instead of reusing it.
  const healed = setGuestIdentity('Jamie', 'jamie@example.com');
  assert.notEqual(healed.token, 'a'.repeat(72));
  assert.ok(healed.token.length <= 64);
});
