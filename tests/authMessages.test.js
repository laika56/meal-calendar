import assert from 'node:assert/strict';
import test from 'node:test';

import { authErrorMessage, validationMessage } from '../src/lib/authMessages.js';

test('authErrorMessage maps every specified Firebase Auth code', () => {
  const cases = [
    ['auth/email-already-in-use', '이미 사용 중인 이메일입니다.'],
    ['auth/credential-already-in-use', '이미 사용 중인 이메일입니다.'],
    ['auth/invalid-email', '이메일 형식이 올바르지 않습니다.'],
    ['auth/weak-password', '비밀번호가 너무 짧습니다. 8자 이상으로 정해주세요.'],
    ['auth/wrong-password', '이메일 또는 비밀번호가 맞지 않습니다.'],
    ['auth/user-not-found', '이메일 또는 비밀번호가 맞지 않습니다.'],
    ['auth/invalid-credential', '이메일 또는 비밀번호가 맞지 않습니다.'],
    ['auth/too-many-requests', '시도가 너무 많습니다. 잠시 후 다시 해주세요.'],
    ['auth/network-request-failed', '네트워크에 연결할 수 없습니다.'],
    ['auth/requires-recent-login', '보안을 위해 다시 로그인한 뒤 시도해주세요.'],
    ['auth/operation-not-allowed', '이 로그인 방식이 꺼져 있습니다. 설정을 확인해주세요.'],
  ];

  for (const [code, expected] of cases) {
    assert.equal(authErrorMessage(code), expected);
  }
});

test('authErrorMessage uses the specified fallback without hiding the code', () => {
  assert.equal(authErrorMessage('auth/unknown'), '로그인 처리 중 문제가 생겼습니다. (auth/unknown)');
  assert.equal(authErrorMessage(''), '로그인 처리 중 문제가 생겼습니다. ()');
  assert.equal(authErrorMessage(null), '로그인 처리 중 문제가 생겼습니다. (null)');
  assert.equal(authErrorMessage(undefined), '로그인 처리 중 문제가 생겼습니다. (undefined)');
});

test('authErrorMessage rejects unsupported input types with TypeError', () => {
  for (const value of [1, {}]) {
    assert.throws(() => authErrorMessage(value), TypeError);
  }
});

test('validationMessage maps every specified validation failure', () => {
  const cases = [
    ['email', 'empty', '이메일을 입력해주세요.'],
    ['email', 'format', '이메일 형식이 올바르지 않습니다.'],
    ['email', 'tooLong', '이메일이 너무 깁니다.'],
    ['password', 'empty', '비밀번호를 입력해주세요.'],
    ['password', 'tooShort', '비밀번호는 8자 이상이어야 합니다.'],
    ['password', 'whitespaceOnly', '비밀번호가 공백뿐입니다.'],
    ['confirm', 'mismatch', '비밀번호가 서로 다릅니다.'],
  ];

  for (const [field, reason, expected] of cases) {
    assert.equal(validationMessage(field, reason), expected);
  }
});

test('validationMessage includes unknown field and reason in its fallback', () => {
  assert.equal(validationMessage('email', 'unknown'), '입력을 확인해주세요. (email/unknown)');
  assert.equal(validationMessage(null, undefined), '입력을 확인해주세요. (null/undefined)');
});
