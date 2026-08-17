export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(msg) {
  throw new ValidationError(msg);
}

function str(v, { min, max, field }) {
  if (typeof v !== 'string') fail(`${field} must be text`);
  const t = v.trim();
  if (min != null && t.length < min) fail(`${field} must be at least ${min} characters`);
  if (max != null && t.length > max) fail(`${field} must be at most ${max} characters`);
  return t;
}

function optionalNonNegInt(v, field) {
  if (v === undefined || v === null) return v ?? null;
  if (!Number.isInteger(v) || v < 0) fail(`${field} must be a non-negative whole number`);
  return v;
}

export function validateWorkspaceInput(body) {
  if (!body || typeof body !== 'object') fail('Invalid request body');
  const name = str(body.name, { min: 2, max: 100, field: 'Name' });
  const description =
    body.description === undefined || body.description === null || body.description === ''
      ? undefined
      : str(body.description, { min: 0, max: 500, field: 'Description' });
  const driveUrl = str(body.driveUrl, { min: 1, max: 2048, field: 'Drive URL' });
  let url;
  try {
    url = new URL(driveUrl);
  } catch {
    fail('Enter a valid URL');
  }
  if (!/drive\.google\.com/.test(driveUrl)) fail('Use a Google Drive folder or file URL');
  return { name, description, driveUrl: url.toString() };
}

const ANNOTATION_TYPES = new Set(['pin', 'arrow', 'circle']);

export function validateCommentInput(body) {
  if (!body || typeof body !== 'object') fail('Invalid request body');
  const isReply = body.parentId != null;
  if (isReply && !isUuid(body.parentId)) fail('Invalid parentId');
  const result = {
    body: str(body.body, { min: 1, max: 5000, field: 'Comment' }),
    parentId: isReply ? body.parentId : null,
    // A reply doesn't get its own timeline/marker anchor — it's attached
    // to its parent comment instead. Force these to null rather than
    // trusting the client not to send them, so the invariant holds no
    // matter what a caller sends.
    timestampMs: isReply ? null : optionalNonNegInt(body.timestampMs, 'timestampMs'),
    rangeStartMs: isReply ? null : optionalNonNegInt(body.rangeStartMs, 'rangeStartMs'),
    rangeEndMs: isReply ? null : optionalNonNegInt(body.rangeEndMs, 'rangeEndMs'),
    annotation: null,
  };
  if (!isReply && body.annotation != null) {
    const a = body.annotation;
    if (
      typeof a !== 'object' ||
      typeof a.x !== 'number' ||
      a.x < 0 ||
      a.x > 1 ||
      typeof a.y !== 'number' ||
      a.y < 0 ||
      a.y > 1 ||
      !ANNOTATION_TYPES.has(a.type)
    ) {
      fail('Invalid annotation');
    }
    result.annotation = { x: a.x, y: a.y, type: a.type };
  }
  if (result.rangeStartMs != null && result.rangeEndMs != null && result.rangeEndMs < result.rangeStartMs) {
    fail('Invalid range');
  }
  if (!isReply) {
    const anchors = [result.timestampMs != null, result.rangeStartMs != null, result.annotation != null].filter(
      Boolean,
    ).length;
    if (anchors !== 1) fail('A comment needs exactly one media anchor');
  }
  return result;
}

export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A guest's identity for a share-link review session: name + email they
// typed once, plus a client-generated capability token (see
// supabase/migrations/0002_sharing_and_guests.sql for what that token is
// for). The server never generates this token — it only ever compares
// what the guest's own browser already remembers.
export function validateGuestIdentity(body) {
  if (!body || typeof body !== 'object') fail('Invalid request body');
  const name = str(body.guestName, { min: 1, max: 100, field: 'Name' });
  const email = str(body.guestEmail, { min: 3, max: 320, field: 'Email' });
  if (!EMAIL_RE.test(email)) fail('Enter a valid email address');
  const token = str(body.guestToken, { min: 16, max: 64, field: 'guestToken' });
  return { name, email, token };
}
