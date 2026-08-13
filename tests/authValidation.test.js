import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
  validateSignUpForm,
} from '../src/lib/authValidation.js';

test('validateEmail accepts valid addresses and trims surrounding whitespace', () => {
  assert.deepEqual(validateEmail('a@b.co'), { ok: true });
  assert.deepEqual(validateEmail('  a@b.co  '), { ok: true });
});

test('validateEmail rejects empty and whitespace-only values', () => {
  assert.deepEqual(validateEmail(''), { ok: false, reason: 'empty' });
  assert.deepEqual(validateEmail('   '), { ok: false, reason: 'empty' });
});

test('validateEmail rejects every specified malformed address', () => {
  for (const email of ['ab.co', 'a@', '@b.co', 'a@b', 'a b@c.co']) {
    assert.deepEqual(validateEmail(email), { ok: false, reason: 'format' });
  }
});

test('validateEmail accepts 255 trimmed characters and rejects 256', () => {
  assert.deepEqual(validateEmail(`${'a'.repeat(250)}@b.co`), { ok: true });
  assert.deepEqual(validateEmail(` ${'a'.repeat(251)}@b.co `), {
    ok: false,
    reason: 'tooLong',
  });
});

test('validateEmail rejects non-string inputs with TypeError', () => {
  for (const value of [null, undefined, 1, {}]) {
    assert.throws(() => validateEmail(value), TypeError);
  }
});

test('validatePassword exports and applies the eight-character minimum', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.deepEqual(validatePassword('abcd123'), { ok: false, reason: 'tooShort' });
  assert.deepEqual(validatePassword('abcd1234'), { ok: true });
  assert.deepEqual(validatePassword('abcd12345'), { ok: true });
  assert.deepEqual(validatePassword('abcdefghij'), { ok: true });
});

test('validatePassword follows empty, whitespace-only, then too-short precedence', () => {
  assert.deepEqual(validatePassword(''), { ok: false, reason: 'empty' });
  assert.deepEqual(validatePassword('        '), { ok: false, reason: 'whitespaceOnly' });
  assert.deepEqual(validatePassword('  ab  '), { ok: false, reason: 'tooShort' });
});

test('validatePassword rejects non-string inputs with TypeError', () => {
  for (const value of [null, 1, {}]) {
    assert.throws(() => validatePassword(value), TypeError);
  }
});

test('validatePasswordConfirm requires exact untrimmed equality', () => {
  assert.deepEqual(validatePasswordConfirm('abcd1234', 'abcd1234'), { ok: true });
  assert.deepEqual(validatePasswordConfirm('abcd1234', 'abcd12345'), {
    ok: false,
    reason: 'mismatch',
  });
  assert.deepEqual(validatePasswordConfirm('abcd1234', ''), {
    ok: false,
    reason: 'mismatch',
  });
});

test('validatePasswordConfirm rejects either non-string input with TypeError', () => {
  assert.throws(() => validatePasswordConfirm(null, 'abcd1234'), TypeError);
  assert.throws(() => validatePasswordConfirm('abcd1234', null), TypeError);
});

test('validateSignUpForm returns only the first failure in field order', () => {
  assert.deepEqual(validateSignUpForm({ email: '', password: '', confirm: 'different' }), {
    ok: false,
    field: 'email',
    reason: 'empty',
  });
  assert.deepEqual(validateSignUpForm({
    email: 'a@b.co',
    password: 'short',
    confirm: 'different',
  }), { ok: false, field: 'password', reason: 'tooShort' });
  assert.deepEqual(validateSignUpForm({
    email: 'a@b.co',
    password: 'abcd1234',
    confirm: 'different',
  }), { ok: false, field: 'confirm', reason: 'mismatch' });
});

test('validateSignUpForm returns ok after every field passes', () => {
  assert.deepEqual(validateSignUpForm({
    email: 'a@b.co',
    password: 'abcd1234',
    confirm: 'abcd1234',
  }), { ok: true });
});

test('validateSignUpForm rejects non-objects and lets missing fields raise TypeError', () => {
  for (const value of [null, undefined, 'form', 1, []]) {
    assert.throws(() => validateSignUpForm(value), TypeError);
  }
  assert.throws(() => validateSignUpForm({}), TypeError);
});
