const TESSERACT_MODULE = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

function defaultLoader() {
  return import(TESSERACT_MODULE);
}

export async function createNutritionLabelRecognizer({ loadTesseract = defaultLoader } = {}) {
  const tesseract = await loadTesseract();
  if (typeof tesseract?.createWorker !== 'function') throw new TypeError('Tesseract createWorker is unavailable');
  const worker = await tesseract.createWorker('kor+eng');
  let closed = false;
  return Object.freeze({
    async recognize(image) {
      if (!image) throw new TypeError('nutrition label image is required');
      if (closed) throw new Error('nutrition label recognizer is closed');
      const result = await worker.recognize(image);
      if (typeof result?.data?.text !== 'string') throw new TypeError('OCR result text is unavailable');
      return result.data.text;
    },
    async close() {
      if (closed) return;
      closed = true;
      await worker.terminate();
    },
  });
}

export async function recognizeNutritionLabel(file, { loadTesseract = defaultLoader } = {}) {
  if (!file) throw new TypeError('nutrition label image is required');
  const recognizer = await createNutritionLabelRecognizer({ loadTesseract });
  try {
    return await recognizer.recognize(file);
  } finally {
    await recognizer.close();
  }
}
