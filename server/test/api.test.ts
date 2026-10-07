/**
 * API integration tests: validation, persistence, stats, error handling.
 * Scoring is verified to happen server-side only.
 */

import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Database } from "../src/db.js";

let db: Database;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = new Database(":memory:");
  app = createApp(db);
});

describe("GET /api/health", () => {
  it("reports ok and server-side scoring", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.scoring).toBe("server-side");
  });
});

describe("POST /api/scan", () => {
  it("analyzes and persists a scan with full detector matrix", async () => {
    const res = await request(app)
      .post("/api/scan")
      .send({ payload: "https://paypal-secure-login.example.com/verify", source: "manual" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.classification).toBe("DANGEROUS");
    expect(Array.isArray(res.body.detectors)).toBe(true);
    expect(res.body.detectors.length).toBeGreaterThan(10);
    expect(res.body.recommendation).toMatch(/Do not open/i);
  });

  it("ignores client-supplied risk scores (server computes)", async () => {
    const res = await request(app)
      .post("/api/scan")
      .send({ payload: "https://example.com", riskScore: 99, classification: "DANGEROUS" });
    expect(res.status).toBe(201);
    expect(res.body.classification).toBe("SAFE");
    expect(res.body.riskScore).toBeLessThan(30);
  });

  it("rejects missing payload", async () => {
    const res = await request(app).post("/api/scan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("rejects oversized payload", async () => {
    const res = await request(app)
      .post("/api/scan")
      .send({ payload: "a".repeat(9000) });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/scan")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Malformed JSON/);
  });
});

describe("POST /api/analyze (no persistence)", () => {
  it("returns analysis without writing to history", async () => {
    const res = await request(app)
      .post("/api/analyze")
      .send({ payload: "http://example.com" });
    expect(res.status).toBe(200);
    expect(res.body.riskScore).toBeGreaterThanOrEqual(0);
    const history = await request(app).get("/api/history");
    expect(history.body.total).toBe(0);
  });
});

describe("history lifecycle", () => {
  it("supports list, search, filter, detail, delete, clear", async () => {
    await request(app).post("/api/scan").send({ payload: "https://example.com" });
    await request(app).post("/api/scan").send({ payload: "http://192.0.2.1:8443/login" });
    await request(app).post("/api/scan").send({ payload: "upi://pay?pa=x@ybl&am=10" });

    const all = await request(app).get("/api/history");
    expect(all.body.total).toBe(3);

    const filtered = await request(app).get("/api/history?classification=DANGEROUS");
    expect(filtered.body.items.every((i: { classification: string }) => i.classification !== "SAFE")).toBe(true);

    const searched = await request(app).get("/api/history?q=192.0.2.1");
    expect(searched.body.total).toBe(1);

    const sorted = await request(app).get("/api/history?sort=risk_desc");
    const scores = sorted.body.items.map((i: { riskScore: number }) => i.riskScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    const detail = await request(app).get("/api/scan/1");
    expect(detail.status).toBe(200);
    expect(detail.body.detectors.length).toBeGreaterThan(10);

    const missing = await request(app).get("/api/scan/9999");
    expect(missing.status).toBe(404);

    const badId = await request(app).get("/api/scan/abc");
    expect(badId.status).toBe(400);

    const del = await request(app).delete("/api/scan/1");
    expect(del.status).toBe(200);
    expect((await request(app).get("/api/history")).body.total).toBe(2);

    // Spec §19 path: DELETE /api/history/:id
    const delByHistory = await request(app).delete("/api/history/2");
    expect(delByHistory.status).toBe(200);
    expect((await request(app).get("/api/history")).body.total).toBe(1);
    const delMissing = await request(app).delete("/api/history/9999");
    expect(delMissing.status).toBe(404);
    const delBad = await request(app).delete("/api/history/abc");
    expect(delBad.status).toBe(400);

    const clear = await request(app).delete("/api/history");
    expect(clear.body.deleted).toBe(1);
    expect((await request(app).get("/api/history")).body.total).toBe(0);
  });

  it("rejects invalid query params", async () => {
    const res = await request(app).get("/api/history?limit=9999");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/stats", () => {
  it("aggregates only real stored scans", async () => {
    const empty = await request(app).get("/api/stats");
    expect(empty.body.total).toBe(0);
    expect(empty.body.topThreats).toEqual([]);

    await request(app).post("/api/scan").send({ payload: "https://example.com" });
    await request(app).post("/api/scan").send({ payload: "http://192.0.2.1/login/verify" });

    const stats = await request(app).get("/api/stats");
    expect(stats.body.total).toBe(2);
    expect(stats.body.safe + stats.body.suspicious + stats.body.dangerous).toBe(2);
    expect(stats.body.threatsDetected).toBeGreaterThan(0);
    expect(stats.body.byDay.length).toBeGreaterThan(0);
    expect(typeof stats.body.avgScore).toBe("number");
  });
});

describe("GET /api/scan/:id detail", () => {
  it("returns every detector with evidence for analyst mode", async () => {
    const created = await request(app)
      .post("/api/scan")
      .send({ payload: "https://paypal-secure-login.example.com/verify" });
    const detail = await request(app).get(`/api/scan/${created.body.id}`);
    const brand = detail.body.detectors.find((d: { detector: string }) => d.detector === "brand_impersonation");
    expect(brand.triggered).toBe(true);
    expect(brand.evidence.length).toBeGreaterThan(0);
    expect(brand.score).toBeGreaterThan(0);
    // non-triggered detectors still present
    expect(detail.body.detectors.some((d: { triggered: boolean }) => !d.triggered)).toBe(true);
  });
});

describe("unknown routes", () => {
  it("returns JSON 404 under /api", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});
