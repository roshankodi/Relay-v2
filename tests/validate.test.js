import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspaceInput, validateCommentInput, isUuid, ValidationError } from '../lib/validate.js';
import { folderIdFromUrl } from '../lib/drive.js';

test('validateWorkspaceInput accepts a valid workspace', () => {
  const result = validateWorkspaceInput({
    name: 'Campaign B-roll',
    description: 'Q3 assets',
    driveUrl: 'https://drive.google.com/drive/folders/1AbCdEf_23',
  });
  assert.equal(result.name, 'Campaign B-roll');
  assert.equal(result.description, 'Q3 assets');
});

test('validateWorkspaceInput rejects a non-Drive URL', () => {
  assert.throws(
    () => validateWorkspaceInput({ name: 'X', driveUrl: 'https://example.com/folder' }),
    ValidationError,
  );
});

test('validateWorkspaceInput rejects a too-short name', () => {
  assert.throws(
    () => validateWorkspaceInput({ name: 'A', driveUrl: 'https://drive.google.com/drive/folders/1x' }),
    ValidationError,
  );
});

test('validateCommentInput accepts a timestamp comment', () => {
  const result = validateCommentInput({ body: 'Nice cut here', timestampMs: 12000 });
  assert.equal(result.timestampMs, 12000);
});

test('validateCommentInput requires exactly one anchor', () => {
  assert.throws(() => validateCommentInput({ body: 'x' }), ValidationError);
  assert.throws(
    () => validateCommentInput({ body: 'x', timestampMs: 1, rangeStartMs: 1, rangeEndMs: 2 }),
    ValidationError,
  );
});

test('validateCommentInput rejects an inverted range', () => {
  assert.throws(
    () => validateCommentInput({ body: 'x', rangeStartMs: 5000, rangeEndMs: 1000 }),
    ValidationError,
  );
});

test('validateCommentInput rejects an out-of-bounds annotation', () => {
  assert.throws(
    () => validateCommentInput({ body: 'x', annotation: { x: 1.5, y: 0.2, type: 'pin' } }),
    ValidationError,
  );
});

test('validateCommentInput accepts a reply with no anchor', () => {
  const parentId = '123e4567-e89b-12d3-a456-426614174000';
  const result = validateCommentInput({ body: 'agreed', parentId });
  assert.equal(result.parentId, parentId);
  assert.equal(result.timestampMs, null);
  assert.equal(result.rangeStartMs, null);
  assert.equal(result.annotation, null);
});

test('validateCommentInput ignores anchor fields sent alongside a reply (forces them null)', () => {
  const parentId = '123e4567-e89b-12d3-a456-426614174000';
  const result = validateCommentInput({ body: 'agreed', parentId, timestampMs: 5000, annotation: { x: 0.1, y: 0.1, type: 'pin' } });
  assert.equal(result.timestampMs, null);
  assert.equal(result.annotation, null);
});

test('validateCommentInput rejects a malformed parentId', () => {
  assert.throws(() => validateCommentInput({ body: 'x', parentId: 'not-a-uuid' }), ValidationError);
});

test('folderIdFromUrl extracts the folder id', () => {
  assert.equal(folderIdFromUrl('https://drive.google.com/drive/folders/1AbC-def_23'), '1AbC-def_23');
  assert.equal(folderIdFromUrl('https://drive.google.com/open?id=1AbC-def_23'), '1AbC-def_23');
});

test('folderIdFromUrl rejects a URL with no folder id', () => {
  assert.throws(() => folderIdFromUrl('https://drive.google.com/drive/my-drive'));
});

test('isUuid validates UUID shape', () => {
  assert.equal(isUuid('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(isUuid('not-a-uuid'), false);
});
