function requireFrame(rgba, width, height) {
  if (!(rgba instanceof Uint8ClampedArray)) throw new TypeError('rgba must be a Uint8ClampedArray');
  if (!Number.isInteger(width) || width <= 0) throw new TypeError('width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw new TypeError('height must be a positive integer');
  if (rgba.length !== width * height * 4) throw new RangeError('rgba length does not match frame dimensions');
}

export function labelFrameSignature(rgba, width, height) {
  requireFrame(rgba, width, height);
  const samples = [];
  const stride = Math.max(1, Math.floor((width * height) / 256));
  for (let pixel = 0; pixel < width * height; pixel += stride) {
    const offset = pixel * 4;
    samples.push(Math.round(
      (rgba[offset] * 0.299) + (rgba[offset + 1] * 0.587) + (rgba[offset + 2] * 0.114),
    ));
  }
  let contrast = 0;
  for (let index = 1; index < samples.length; index += 1) {
    contrast += Math.abs(samples[index] - samples[index - 1]);
  }
  return Object.freeze({
    samples: Object.freeze(samples),
    sharpness: samples.length > 1 ? contrast / (samples.length - 1) : 0,
  });
}

export function assessLabelFrame(previous, current, {
  minSharpness = 30,
  maxDifference = 8,
} = {}) {
  if (!current || !Array.isArray(current.samples) || !Number.isFinite(current.sharpness)) {
    throw new TypeError('current frame signature is invalid');
  }
  const sharp = current.sharpness >= minSharpness;
  if (!previous || !Array.isArray(previous.samples) || previous.samples.length !== current.samples.length) {
    return { sharp, stable: false };
  }
  const difference = current.samples.reduce(
    (total, value, index) => total + Math.abs(value - previous.samples[index]),
    0,
  ) / current.samples.length;
  return { sharp, stable: sharp && difference <= maxDifference };
}
