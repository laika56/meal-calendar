const BODY_LENGTHS = new Set([7, 11, 12]);
const CODE_LENGTHS = new Set([8, 12, 13]);

export function barcodeCheckDigit(body) {
  if (
    typeof body !== 'string'
    || !BODY_LENGTHS.has(body.length)
    || !/^\d+$/.test(body)
  ) {
    throw new TypeError('barcode: body must be 7, 11, or 12 digits');
  }

  let sum = 0;
  for (let index = body.length - 1, offset = 0; index >= 0; index -= 1, offset += 1) {
    sum += Number(body[index]) * (offset % 2 === 0 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10;
}

export function isValidBarcode(code) {
  if (
    typeof code !== 'string'
    || !CODE_LENGTHS.has(code.length)
    || !/^\d+$/.test(code)
  ) {
    return false;
  }

  // Length alone determines the format, so a truncated EAN-13 can happen to
  // validate as UPC-A. toEan13 then normalizes that 12-digit value as UPC-A.
  const body = code.slice(0, -1);
  return barcodeCheckDigit(body) === Number(code.at(-1));
}

export function toEan13(code) {
  if (!isValidBarcode(code)) return null;
  if (code.length === 13) return code;
  if (code.length === 12) return `0${code}`;
  return null;
}

export function upcEToUpcA(code) {
  if (typeof code !== 'string' || !/^\d{8}$/.test(code)) return null;

  const [system, b1, b2, b3, b4, b5, b6, checkDigit] = code;
  let body;

  if (b6 === '0' || b6 === '1' || b6 === '2') {
    body = `${system}${b1}${b2}${b6}0000${b3}${b4}${b5}`;
  } else if (b6 === '3') {
    body = `${system}${b1}${b2}${b3}00000${b4}${b5}`;
  } else if (b6 === '4') {
    body = `${system}${b1}${b2}${b3}${b4}00000${b5}`;
  } else {
    body = `${system}${b1}${b2}${b3}${b4}${b5}0000${b6}`;
  }

  const upcA = `${body}${checkDigit}`;
  return isValidBarcode(upcA) ? upcA : null;
}
