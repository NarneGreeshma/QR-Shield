/**
 * Real QR image decode tests: generate genuine QR PNGs/JPEGs with the
 * `qrcode` package (dev-only), then decode them through the server pipeline.
 */

import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import * as jpeg from "jpeg-js";
import { decodeQrBuffer } from "../src/decode.js";

const PAYLOAD = "https://example.com/hello-qr-shield";

/** Render a QR code into an RGBA bitmap (white background, black modules). */
function qrToRgba(text: string): { data: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const bits = qr.modules.data;
  const scale = 8;
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!bits[y * size + x]) continue;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = (((y + quiet) * scale + py) * dim + (x + quiet) * scale + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

describe("server-side QR decoding", () => {
  it("decodes a generated PNG QR code", async () => {
    const png = await QRCode.toBuffer(PAYLOAD, { type: "png", width: 400, margin: 2 });
    const result = decodeQrBuffer(png, "image/png");
    expect(result.ok).toBe(true);
    expect(result.text).toBe(PAYLOAD);
  });

  it("decodes a generated JPEG QR code", async () => {
    // `qrcode`'s node renderer only emits PNG (it ignores type:"jpeg"), so we
    // build the QR pixel matrix ourselves and encode a genuine JPEG with
    // jpeg-js — this exercises the real JPEG branch of decodeQrBuffer.
    const { width, height, data } = qrToRgba(PAYLOAD);
    const encoded = jpeg.encode({ data, width, height }, 90).data;
    // Sanity: this must really be a JPEG (SOI marker ff d8).
    expect(encoded[0]).toBe(0xff);
    expect(encoded[1]).toBe(0xd8);
    const result = decodeQrBuffer(Buffer.from(encoded), "image/jpeg");
    expect(result.ok).toBe(true);
    expect(result.text).toBe(PAYLOAD);
  });

  it("decodes a dark-on-light inverted QR via preprocessing fallback", async () => {
    // Render white-on-black by inverting the PNG pixels manually.
    const png = await QRCode.toBuffer(PAYLOAD, { type: "png", width: 400, margin: 2, color: { dark: "#ffffff", light: "#000000" } });
    const result = decodeQrBuffer(png, "image/png");
    // jsQR attemptBoth may catch it directly; either way the decode must succeed.
    expect(result.ok).toBe(true);
    expect(result.text).toBe(PAYLOAD);
  });

  it("returns a useful error for non-QR images", async () => {
    // A plain 100x100 gray PNG with no QR structure.
    const { PNG } = await import("pngjs");
    const png = new PNG({ width: 100, height: 100 });
    png.data.fill(128);
    const buf = PNG.sync.write(png);
    const result = decodeQrBuffer(buf, "image/png");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No QR code could be decoded/);
    expect(result.attempts?.length).toBeGreaterThan(0);
  });

  it("rejects unsupported image types", () => {
    const result = decodeQrBuffer(Buffer.from("notanimage"), "image/gif");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported/);
  });

  it("handles corrupt image data gracefully", () => {
    const result = decodeQrBuffer(Buffer.from("corrupted-png-bytes"), "image/png");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Could not read image/);
  });
});
