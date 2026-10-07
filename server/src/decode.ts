/**
 * Server-side QR decoding for uploaded images (PNG/JPEG).
 * The camera path decodes on-device in the browser; this endpoint exists
 * for image uploads, API clients and tests. Uses jsQR (pure JS, MIT).
 */

import * as jsQRModule from "jsqr";

// jsQR is CJS; under NodeNext the namespace import carries the callable as
// either the module itself or `.default`, depending on interop.
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => { data: string } | null;
const jsQR: JsQrFn =
  (jsQRModule as unknown as { default?: JsQrFn }).default ?? (jsQRModule as unknown as JsQrFn);
import { PNG } from "pngjs";
import * as jpeg from "jpeg-js";

export interface DecodeResult {
  ok: boolean;
  text?: string;
  error?: string;
  attempts?: string[];
}

function decodeOnce(data: Uint8ClampedArray, width: number, height: number): string | null {
  const result = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return result?.data ?? null;
}

function grayscale(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const y = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = y;
    out[i + 3] = 255;
  }
  return out;
}

function contrast(src: Uint8ClampedArray, factor = 1.6): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.max(0, Math.min(255, (src[i + c] - 128) * factor + 128));
    }
    out[i + 3] = 255;
  }
  return out;
}

function invert(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = 255 - src[i];
    out[i + 1] = 255 - src[i + 1];
    out[i + 2] = 255 - src[i + 2];
    out[i + 3] = 255;
  }
  return out;
}

/** Decode a PNG or JPEG buffer, trying preprocessing fallbacks. */
export function decodeQrBuffer(buffer: Buffer, mimeType: string): DecodeResult {
  let pixels: Uint8ClampedArray;
  let width: number;
  let height: number;

  try {
    if (mimeType.includes("png")) {
      const png = PNG.sync.read(buffer);
      pixels = new Uint8ClampedArray(png.data);
      width = png.width;
      height = png.height;
    } else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      const img = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
      pixels = new Uint8ClampedArray(img.data);
      width = img.width;
      height = img.height;
    } else {
      return { ok: false, error: `Unsupported image type "${mimeType}". Use PNG or JPEG.` };
    }
  } catch (err) {
    return { ok: false, error: `Could not read image: ${(err as Error).message}` };
  }

  const attempts: string[] = [];
  const attempt = (name: string, data: Uint8ClampedArray): string | null => {
    const text = decodeOnce(data, width, height);
    if (text !== null) attempts.push(`${name}: success`);
    else attempts.push(`${name}: no QR found`);
    return text;
  };

  const plain = attempt("original", pixels);
  if (plain !== null) return { ok: true, text: plain, attempts };

  const gray = attempt("grayscale", grayscale(pixels));
  if (gray !== null) return { ok: true, text: gray, attempts };

  const contrasted = attempt("contrast", contrast(grayscale(pixels)));
  if (contrasted !== null) return { ok: true, text: contrasted, attempts };

  const inverted = attempt("inverted", invert(pixels));
  if (inverted !== null) return { ok: true, text: inverted, attempts };

  return {
    ok: false,
    error: "No QR code could be decoded from this image. Try a sharper, well-lit photo with the code filling most of the frame.",
    attempts,
  };
}
