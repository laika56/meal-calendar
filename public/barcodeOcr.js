const TESSERACT_MODULE = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

function defaultLoader() {
  return import(TESSERACT_MODULE);
}

export async function createBarcodeRecognizer({ loadTesseract = defaultLoader } = {}) {
  const tesseract = await loadTesseract();
  if (typeof tesseract?.createWorker !== 'function') {
    throw new TypeError('Tesseract createWorker is unavailable');
  }
  const worker = await tesseract.createWorker('eng');
  try {
    if (typeof worker?.setParameters !== 'function') {
      throw new TypeError('Tesseract setParameters is unavailable');
    }
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '6',
    });
  } catch (error) {
    await worker?.terminate?.();
    throw error;
  }

  let closed = false;
  return Object.freeze({
    async recognize(image) {
      if (!image) throw new TypeError('barcode image is required');
      if (closed) throw new Error('barcode recognizer is closed');
      const result = await worker.recognize(image);
      if (typeof result?.data?.text !== 'string') {
        throw new TypeError('OCR result text is unavailable');
      }
      return result.data.text;
    },
    async close() {
      if (closed) return;
      closed = true;
      await worker.terminate();
    },
  });
}
