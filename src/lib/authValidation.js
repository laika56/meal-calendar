const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 255;

export const MIN_PASSWORD_LENGTH = 8;

function requireString(value, name) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
}

export function validateEmail(email) {
  requireString(email, 'email');

  const trimmed = email.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_EMAIL_LENGTH) return { ok: false, reason: 'tooLong' };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, reason: 'format' };
  return { ok: true };
}

export function validatePassword(password) {
  requireString(password, 'password');

  if (password.length === 0) return { ok: false, reason: 'empty' };
  if (password.trim().length === 0) return { ok: false, reason: 'whitespaceOnly' };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'tooShort' };
  return { ok: true };
}

export function validatePasswordConfirm(password, confirm) {
  requireString(password, 'password');
  requireString(confirm, 'confirm');

  if (password !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

export function validateSignUpForm(form) {
  if (form === null || typeof form !== 'object' || Array.isArray(form)) {
    throw new TypeError('form must be an object');
  }

  const emailResult = validateEmail(form.email);
  if (!emailResult.ok) return { ok: false, field: 'email', reason: emailResult.reason };

  const passwordResult = validatePassword(form.password);
  if (!passwordResult.ok) {
    return { ok: false, field: 'password', reason: passwordResult.reason };
  }

  const confirmResult = validatePasswordConfirm(form.password, form.confirm);
  if (!confirmResult.ok) return { ok: false, field: 'confirm', reason: confirmResult.reason };

  return { ok: true };
}
