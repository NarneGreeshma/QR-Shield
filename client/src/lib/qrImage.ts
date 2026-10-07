/**
 * Real QR decoding for uploaded images — jsQR runs entirely in the browser.
 * If the first pass fails we try grayscale → contrast → inversion, and we
 * never upscale (original resolution is preserved).
 */

import jsQR from "jsqr";

export interface DecodeOutcome {
  ok: boolean;
  text?: string;
  error?: string;
  attempts: string[];
}

type Transform = { name: string; apply: (d: Uint8ClampedArray) => Uint8ClampedArray };

const identity: Transform = { name: "original", apply: (d) => d };

const grayscale: Transform = {
  name: "grayscale",
  apply: (src) => {
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const y = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
      out[i] = out[i + 1] = out[i + 2] = y;
      out[i + 3] = 255;
    }
    return out;
  },
};

const contrast = (factor = 1.7): Transform => ({
  name: `contrast(${factor})`,
  apply: (src) => {
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.max(0, Math.min(255, (src[i + c] - 128) * factor + 128));
      }
      out[i + 3] = 255;
    }
    return out;
  },
});

const invert: Transform = {
  name: "inverted",
  apply: (src) => {
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      out[i] = 255 - src[i];
      out[i + 1] = 255 - src[i + 1];
      out[i + 2] = 255 - src[i + 2];
      out[i + 3] = 255;
    }
    return out;
  },
};

const TRANSFORMS: Transform[] = [identity, grayscale, contrast(1.7), invert];

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The file could not be read as an image."));
    };
    img.src = url;
  });
}

/** Decode a QR image file. Returns a structured outcome either way. */
export async function decodeImageFile(file: File): Promise<DecodeOutcome> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    return { ok: false, error: `Unsupported file type "${file.type || "unknown"}". Use PNG, JPG or WebP.`, attempts: [] };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { ok: false, error: "Image is larger than 15 MB. Please use a smaller file.", attempts: [] };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(file);
  } catch (err) {
    return { ok: false, error: (err as Error).message, attempts: [] };
  }

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { ok: false, error: "Canvas is not available in this browser.", attempts: [] };
  }
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const original = imageData.data;

  const attempts: string[] = [];
  for (const t of TRANSFORMS) {
    const pixels = t.apply(original);
    const result = jsQR(pixels, imageData.width, imageData.height, {
      inversionAttempts: t === identity ? "attemptBoth" : "dontInvert",
    });
    if (result?.data) {
      attempts.push(`${t.name}: decoded`);
      return { ok: true, text: result.data, attempts };
    }
    attempts.push(`${t.name}: no QR found`);
  }

  return {
    ok: false,
    error:
      "No QR code found in this image. Tips: use a sharp, well-lit photo and make sure the code fills most of the frame.",
    attempts,
  };
}
