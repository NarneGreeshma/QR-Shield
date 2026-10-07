/**
 * Frontend tests for the API client: error handling, payload shape,
 * and the "never trust client-side verdicts" contract (server returns
 * classification; client sends only payload + source).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("api client", () => {
  it("posts only payload and source for a scan (no client-side score)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ riskScore: 0, classification: "SAFE" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await api.scan("https://example.com", "camera");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/scan");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ payload: "https://example.com", source: "camera" });
    expect(body).not.toHaveProperty("riskScore");
    expect(body).not.toHaveProperty("classification");
  });

  it("throws ApiError with the server message on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse({ error: "Invalid request" }, 400)));
    await expect(api.analyze("x")).rejects.toThrow(ApiError);
    await expect(api.analyze("x")).rejects.toThrow("Invalid request");
  });

  it("maps network failure to an actionable ApiError(0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    try {
      await api.stats();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).message).toMatch(/server is running/i);
    }
  });

  it("builds history query params and parses camelCase responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 1, limit: 25, offset: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await api.history({ q: "paypal", classification: "DANGEROUS", sort: "risk_desc" });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("q=paypal");
    expect(url).toContain("classification=DANGEROUS");
    expect(url).toContain("sort=risk_desc");
    expect(res.total).toBe(1);
    expect(Array.isArray(res.items)).toBe(true);
  });

  it("deleteHistory and clearHistory use DELETE verb", async () => {
    // Each call needs a fresh Response — a Response body can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteScan(7);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/scan/7");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");

    await api.clearHistory();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/history");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });
});
