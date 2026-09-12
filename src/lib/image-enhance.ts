"use client";

/**
 * Client-side image enhancement utilities for better OCR.
 * All operate on HTMLCanvasElement / data URLs in the browser.
 */

export interface EnhancementOptions {
  contrast?: number; // -100..100, 0 = none
  sharpness?: number; // 0..100
  grayscale?: boolean; // convert to grayscale (often improves OCR)
  brightness?: number; // -100..100
  autoContrast?: boolean; // histogram stretch
}

const DEFAULTS: EnhancementOptions = {
  contrast: 15,
  sharpness: 30,
  grayscale: false,
  brightness: 0,
  autoContrast: true,
};

/** Load an image data URL into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/** Apply a simple unsharp mask (sharpening) to image data. */
function unsharpMask(data: Uint8ClampedArray, width: number, height: number, amount: number): void {
  // Simple 3x3 sharpen kernel
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const copy = new Uint8ClampedArray(data);
  const kSize = 3;
  const half = 1;
  const blend = Math.max(0, Math.min(1, amount / 100));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx - half));
          const py = Math.min(height - 1, Math.max(0, y + ky - half));
          const pidx = (py * width + px) * 4;
          const w = kernel[ky * kSize + kx];
          r += copy[pidx] * w;
          g += copy[pidx + 1] * w;
          b += copy[pidx + 2] * w;
        }
      }
      data[idx] = copy[idx] * (1 - blend) + r * blend;
      data[idx + 1] = copy[idx + 1] * (1 - blend) + g * blend;
      data[idx + 2] = copy[idx + 2] * (1 - blend) + b * blend;
    }
  }
}

/** Apply contrast adjustment: factor = (259 * (c + 255)) / (255 * (259 - c)) for c in -255..255 */
function applyContrast(data: Uint8ClampedArray, contrast: number) {
  const c = Math.max(-100, Math.min(100, contrast)) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = factor * (data[i] - 128) + 128;
    data[i + 1] = factor * (data[i + 1] - 128) + 128;
    data[i + 2] = factor * (data[i + 2] - 128) + 128;
  }
}

/** Apply brightness adjustment in -100..100 */
function applyBrightness(data: Uint8ClampedArray, brightness: number) {
  const b = Math.max(-100, Math.min(100, brightness)) * 2.55;
  for (let i = 0; i < data.length; i += 4) {
    data[i] += b;
    data[i + 1] += b;
    data[i + 2] += b;
  }
}

/** Auto contrast via histogram stretch. */
function autoContrastStretch(data: Uint8ClampedArray) {
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  if (max - min < 10) return; // already flat
  const scale = 255 / (max - min);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] - min) * scale;
    data[i + 1] = (data[i + 1] - min) * scale;
    data[i + 2] = (data[i + 2] - min) * scale;
  }
}

/** Convert to grayscale (luminance-weighted). */
function applyGrayscale(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = lum;
  }
}

/**
 * Enhance a document image for OCR. Returns a new JPEG data URL.
 */
export async function enhanceImage(
  srcDataUrl: string,
  options: EnhancementOptions = {}
): Promise<string> {
  const opts = { ...DEFAULTS, ...options };
  const img = await loadImage(srcDataUrl);
  // cap size at 1600px
  const maxDim = 1600;
  let { width, height } = img;
  let scale = 1;
  if (Math.max(width, height) > maxDim) scale = maxDim / Math.max(width, height);
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  if (opts.autoContrast) autoContrastStretch(data);
  if (opts.contrast) applyContrast(data, opts.contrast);
  if (opts.brightness) applyBrightness(data, opts.brightness);
  if (opts.sharpness) unsharpMask(data, width, height, opts.sharpness);
  if (opts.grayscale) applyGrayscale(data);

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/**
 * Estimate simple sharpness (variance of Laplacian) — used as a quick client-side blur check.
 * Higher = sharper.
 */
export async function estimateSharpness(srcDataUrl: string): Promise<number> {
  const img = await loadImage(srcDataUrl);
  const maxDim = 400;
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const s = maxDim / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const gray: number[] = [];
  for (let i = 0; i < imgData.data.length; i += 4) {
    gray.push(0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2]);
  }
  // Laplacian variance
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - width] +
        gray[idx + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return Math.sqrt(Math.max(0, variance));
}
