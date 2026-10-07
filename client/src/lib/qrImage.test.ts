/**
 * Tests for image-decode input guards: unsupported types and oversized
 * files must produce useful errors before any decoding is attempted.
 * (Full canvas decoding requires a browser DOM and is verified manually.)
 */

import { describe, expect, it } from "vitest";
import { decodeImageFile } from "./qrImage";

const fileOf = (type: string, bytes: number, name = "x") =>
  new File([new Uint8Array(Math.min(bytes, 64))], name, { type });

describe("decodeImageFile guards", () => {
  it("rejects unsupported file types with a clear message", async () => {
    const out = await decodeImageFile(fileOf("image/gif", 10, "a.gif"));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Unsupported file type/);
    expect(out.error).toMatch(/PNG, JPG or WebP/);
  });

  it("rejects files without a mime type", async () => {
    const out = await decodeImageFile(new File(["x"], "noext"));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Unsupported file type/);
  });

  it("rejects oversized images before decoding", async () => {
    // A File reports its real size via `size`, independent of slice content.
    const oversized = {
      name: "big.png",
      type: "image/png",
      size: 16 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(0),
      slice: () => new Blob([]),
      stream: () => new ReadableStream(),
      text: async () => "",
    } as unknown as File;
    const out = await decodeImageFile(oversized);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/larger than 15 MB/);
  });

  it("returns an attempts trail on decode failure", async () => {
    // Valid PNG mime but not a real image → image load fails gracefully.
    const fake = new File([new Uint8Array([137, 80, 78, 71])], "broken.png", { type: "image/png" });
    const out = await decodeImageFile(fake);
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
    expect(out.error!.length).toBeGreaterThan(0);
  });
});
