import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeComment, sanitizeComments } from '../lib/comments.js';

const accountRow = { id: 'c1', author_id: 'user-1', body: 'hi', guest_token: null };
const guestRow = { id: 'c2', author_id: null, guest_name: 'Jamie', guest_token: 'secret-token-abc' };

test('sanitizeComment never includes guest_token in its output', () => {
  const out = sanitizeComment(guestRow, { guestToken: 'secret-token-abc', isWorkspaceOwner: false });
  assert.equal('guest_token' in out, false);
});

test('sanitizeComment marks an account holder\'s own comment as editable/deletable', () => {
  const out = sanitizeComment(accountRow, { userId: 'user-1', isWorkspaceOwner: false });
  assert.equal(out.isMine, true);
  assert.equal(out.canEdit, true);
  assert.equal(out.canDelete, true);
});

test('sanitizeComment marks another account holder\'s comment as not editable', () => {
  const out = sanitizeComment(accountRow, { userId: 'user-2', isWorkspaceOwner: false });
  assert.equal(out.isMine, false);
  assert.equal(out.canEdit, false);
  assert.equal(out.canDelete, false);
});

test('workspace owner can delete but not edit someone else\'s comment', () => {
  const out = sanitizeComment(accountRow, { userId: 'user-2', isWorkspaceOwner: true });
  assert.equal(out.isMine, false);
  assert.equal(out.canEdit, false);
  assert.equal(out.canDelete, true);
});

test('guest with the matching token owns their own comment', () => {
  const out = sanitizeComment(guestRow, { guestToken: 'secret-token-abc', isWorkspaceOwner: false });
  assert.equal(out.isMine, true);
  assert.equal(out.canEdit, true);
  assert.equal(out.canDelete, true);
});

test('a different guest token (or none) cannot claim a guest comment', () => {
  const wrongToken = sanitizeComment(guestRow, { guestToken: 'someone-elses-token', isWorkspaceOwner: false });
  assert.equal(wrongToken.isMine, false);
  assert.equal(wrongToken.canDelete, false);

  const noToken = sanitizeComment(guestRow, { isWorkspaceOwner: false });
  assert.equal(noToken.isMine, false);
  assert.equal(noToken.canDelete, false);
});

test('sanitizeComments strips guest_token across a whole list', () => {
  const out = sanitizeComments([accountRow, guestRow], { userId: 'user-1', isWorkspaceOwner: false });
  assert.equal(out.every(c => !('guest_token' in c)), true);
  assert.equal(out[0].isMine, true);
  assert.equal(out[1].isMine, false);
});
