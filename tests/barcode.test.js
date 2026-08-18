import assert from 'node:assert/strict';
import test from 'node:test';

import {
  barcodeCheckDigit,
  isValidBarcode,
  toEan13,
  upcEToUpcA,
} from '../src/lib/barcode.js';

for (const [body, expected] of [
  ['978014300723', 4],
  ['03600029145', 2],
  ['9638507', 4],
]) {
  test(`barcodeCheckDigit calculates ${expected} for ${body}`, () => {
    assert.equal(barcodeCheckDigit(body), expected);
  });
}

test('barcodeCheckDigit rejects non-string input with a prefixed TypeError', () => {
  for (const input of [null, 123, undefined]) {
    assert.throws(
      () => barcodeCheckDigit(input),
      (error) => error instanceof TypeError && error.message.startsWith('barcode: '),
    );
  }
});

test('barcodeCheckDigit rejects non-digit characters with a prefixed TypeError', () => {
  assert.throws(
    () => barcodeCheckDigit('97801430072a'),
    (error) => error instanceof TypeError && error.message.startsWith('barcode: '),
  );
});

test('barcodeCheckDigit rejects unsupported body lengths with a prefixed TypeError', () => {
  for (const input of ['123', '']) {
    assert.throws(
      () => barcodeCheckDigit(input),
      (error) => error instanceof TypeError && error.message.startsWith('barcode: '),
    );
  }
});

for (const [code, expected, label] of [
  ['9780143007234', true, 'valid EAN-13'],
  ['036000291452', true, 'valid UPC-A'],
  ['96385074', true, 'valid EAN-8'],
  ['9780143007235', false, 'wrong check digit'],
  ['978014300723', true, '12-digit UPC-A interpretation'],
  ['97801430072a', false, 'non-digit character'],
]) {
  test(`isValidBarcode returns ${expected} for ${label}`, () => {
    assert.equal(isValidBarcode(code), expected);
  });
}

test('isValidBarcode returns false without throwing for untrusted non-code inputs', () => {
  for (const input of [null, undefined, 12345678, '', {}, []]) {
    assert.doesNotThrow(() => isValidBarcode(input));
    assert.equal(isValidBarcode(input), false);
  }
});

for (const [code, expected, length] of [
  ['9638507', false, 7],
  ['96385074', true, 8],
  ['03600029145', false, 11],
  ['036000291452', true, 12],
  ['9780143007234', true, 13],
  ['97801430072340', false, 14],
]) {
  test(`isValidBarcode handles the ${length}-digit boundary`, () => {
    assert.equal(isValidBarcode(code), expected);
  });
}

test('toEan13 preserves a valid EAN-13', () => {
  assert.equal(toEan13('9780143007234'), '9780143007234');
});

test('toEan13 prefixes a valid UPC-A with zero without changing its check digit', () => {
  assert.equal(toEan13('036000291452'), '0036000291452');
});

test('toEan13 does not pad EAN-8 into a different number system', () => {
  assert.equal(toEan13('96385074'), null);
});

test('toEan13 returns null for invalid or non-string input', () => {
  assert.equal(toEan13('9780143007235'), null);
  assert.equal(toEan13(null), null);
});

test('upcEToUpcA expands the validated UPC-E fixture', () => {
  assert.equal(upcEToUpcA('04252614'), '042100005264');
});

for (const [branch, upcE, upcA] of [
  ['0-2', '01234505', '012000003455'],
  ['3', '01234531', '012300000451'],
  ['4', '01234543', '012340000053'],
  ['5-9', '01234572', '012345000072'],
]) {
  test(`upcEToUpcA expands the B6=${branch} branch`, () => {
    assert.equal(upcEToUpcA(upcE), upcA);
  });
}

test('upcEToUpcA rejects an expansion whose UPC-A check digit does not match', () => {
  assert.equal(upcEToUpcA('01278906'), null);
});

test('upcEToUpcA returns null for malformed input without throwing', () => {
  for (const input of ['9638507', '0123450a', null]) {
    assert.doesNotThrow(() => upcEToUpcA(input));
    assert.equal(upcEToUpcA(input), null);
  }
});
