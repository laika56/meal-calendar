const TESSERACT_MODULE = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

function defaultLoader() {
  return import(TESSERACT_MODULE);
}

export async function recognizeNutritionLabel(file, { loadTesseract = defaultLoader } = {}) {
  if (!file) throw new TypeError('nutrition label image is required');
  const tesseract = await loadTesseract();
  if (typeof tesseract?.createWorker !== 'function') throw new TypeError('Tesseract createWorker is unavailable');
  const worker = await tesseract.createWorker('kor+eng');
  try {
    const result = await worker.recognize(file);
    if (typeof result?.data?.text !== 'string') throw new TypeError('OCR result text is unavailable');
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}
