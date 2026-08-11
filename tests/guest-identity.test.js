import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGuestIdentity, ValidationError } from '../lib/validate.js';

test('validateGuestIdentity accepts a valid guest', () => {
  const result = validateGuestIdentity({ guestName: 'Jamie Rivera', guestEmail: 'jamie@example.com', guestToken: 'a'.repeat(20) });
  assert.equal(result.name, 'Jamie Rivera');
  assert.equal(result.email, 'jamie@example.com');
  assert.equal(result.token, 'a'.repeat(20));
});

test('validateGuestIdentity rejects an invalid email', () => {
  assert.throws(
    () => validateGuestIdentity({ guestName: 'Jamie', guestEmail: 'not-an-email', guestToken: 'a'.repeat(20) }),
    ValidationError,
  );
});

test('validateGuestIdentity rejects a missing name', () => {
  assert.throws(
    () => validateGuestIdentity({ guestName: '', guestEmail: 'jamie@example.com', guestToken: 'a'.repeat(20) }),
    ValidationError,
  );
});

test('validateGuestIdentity rejects a short/missing guest token', () => {
  assert.throws(
    () => validateGuestIdentity({ guestName: 'Jamie', guestEmail: 'jamie@example.com', guestToken: 'short' }),
    ValidationError,
  );
});
