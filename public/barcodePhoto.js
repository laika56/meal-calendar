const PHOTO_OPTIONS = Object.freeze({
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryDenoise: true,
});

export async function recognizeBarcodePhoto(file, {
  readBarcodes,
  normalize,
  createRecognizer,
  extract,
}) {
  if (!file) throw new TypeError('barcode photo is required');
  const results = await readBarcodes(file, PHOTO_OPTIONS);
  const decoded = normalize(results);
  if (decoded !== null) return decoded;

  const recognizer = await createRecognizer();
  try {
    return extract(await recognizer.recognize(file));
  } finally {
    await recognizer.close();
  }
}
