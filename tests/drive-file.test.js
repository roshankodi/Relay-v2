import { test } from 'node:test';
import assert from 'node:assert/strict';

test('fetchDriveFile requests alt=media and forwards a Range header', async t => {
  const originalFetch = globalThis.fetch;
  let capturedUrl, capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedUrl = String(url);
    capturedHeaders = opts?.headers ?? {};
    return { ok: true, status: 206, headers: new Map([['content-range', 'bytes 0-99/1000']]), body: null };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  process.env.GOOGLE_API_KEY ||= 'test-key';
  const { fetchDriveFile } = await import('../lib/drive.js');
  await fetchDriveFile('file123', 'bytes=0-99');

  assert.match(capturedUrl, /\/drive\/v3\/files\/file123/);
  assert.match(capturedUrl, /alt=media/);
  assert.match(capturedUrl, /key=test-key/);
  assert.equal(capturedHeaders.Range, 'bytes=0-99');
});

test('fetchDriveFile omits Range header when none is given', async t => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts?.headers ?? {};
    return { ok: true, status: 200, headers: new Map(), body: null };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  process.env.GOOGLE_API_KEY ||= 'test-key';
  const { fetchDriveFile } = await import('../lib/drive.js');
  await fetchDriveFile('file123');

  assert.equal(capturedHeaders.Range, undefined);
});
