import { describe, expect, it } from "vitest";
import { shouldSuppressDuplicate, DUPLICATE_COOLDOWN_MS } from "./detection";

describe("shouldSuppressDuplicate", () => {
  it("never suppresses without a previous detection", () => {
    expect(shouldSuppressDuplicate("https://a.example", null, 10000)).toBe(false);
  });

  it("suppresses an identical payload inside the cooldown", () => {
    const last = { payload: "upi://pay?pa=x@ybl", at: 1000 };
    expect(shouldSuppressDuplicate("upi://pay?pa=x@ybl", last, 1000 + 500)).toBe(true);
    expect(shouldSuppressDuplicate("upi://pay?pa=x@ybl", last, 1000 + DUPLICATE_COOLDOWN_MS - 1)).toBe(true);
  });

  it("allows the same payload again after the cooldown", () => {
    const last = { payload: "https://a.example", at: 1000 };
    expect(shouldSuppressDuplicate("https://a.example", last, 1000 + DUPLICATE_COOLDOWN_MS)).toBe(false);
    expect(shouldSuppressDuplicate("https://a.example", last, 1000 + DUPLICATE_COOLDOWN_MS + 1)).toBe(false);
  });

  it("never suppresses a different payload", () => {
    const last = { payload: "https://a.example", at: 1000 };
    expect(shouldSuppressDuplicate("https://b.example", last, 1200)).toBe(false);
    expect(shouldSuppressDuplicate("upi://pay?pa=y@ybl", last, 1200)).toBe(false);
  });

  it("guards against clock skew (negative age)", () => {
    const last = { payload: "https://a.example", at: 5000 };
    expect(shouldSuppressDuplicate("https://a.example", last, 4000)).toBe(false);
  });
});
