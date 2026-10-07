/**
 * QR SHIELD API — Express application.
 *
 * Endpoints:
 *   POST /api/scan        analyze a payload (server-side scoring, persisted)
 *   POST /api/decode      decode a QR image (PNG/JPEG) server-side
 *   POST /api/analyze     analyze WITHOUT persisting (demo / preview)
 *   GET  /api/history     list scans (search/filter/sort/pagination)
 *   GET  /api/scan/:id    scan detail incl. every detector result
 *   DELETE /api/scan/:id  delete one scan
 *   DELETE /api/history/:id  delete one scan (spec §19 path)
 *   DELETE /api/history   clear history
 *   GET  /api/stats       real aggregate statistics
 *   GET  /api/health      health + capability report
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Database } from "./db.js";
import { analyze } from "./engine/analyze.js";
import { decodeQrBuffer } from "./decode.js";
import { explainFindings, hasAiConfig } from "./ai.js";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? new URL("../data/qrshield.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const scanSchema = z.object({
  payload: z.string().min(1, "payload is required").max(8192, "payload too long"),
  source: z.enum(["camera", "image", "manual", "demo", "api"]).default("manual"),
});

const decodeSchema = z.object({
  image: z.string().min(1).max(6_000_000, "image data too large"),
  mimeType: z.string().default("image/png"),
});

export function createApp(db: Database) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? true }));
  app.use(express.json({ limit: "8mb" }));

  // Rate limiting: per-IP, practical for a local/hackathon deployment.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and retry shortly." },
  });
  const strictLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many decode requests. Please slow down." },
  });
  app.use("/api/", limiter);

  const wrap = (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      try { fn(req, res); } catch (err) { next(err); }
    };

  /** Shared delete handler for DELETE /api/scan/:id and /api/history/:id. */
  const deleteById = (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid scan id" });
      return;
    }
    const deleted = db.deleteScan(id);
    if (!deleted) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json({ deleted: true });
  };

  // ---- health ------------------------------------------------------------
  app.get("/api/health", wrap((_req, res) => {
    res.json({
      status: "ok",
      service: "qr-shield",
      version: "1.0.0",
      time: new Date().toISOString(),
      ai: hasAiConfig(),
      scoring: "server-side",
    });
  }));

  // ---- analyze (no persistence) -----------------------------------------
  app.post("/api/analyze", wrap((req, res) => {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    res.json(analyze(parsed.data.payload));
  }));

  // ---- scan (analyze + persist) -----------------------------------------
  app.post("/api/scan", wrap((req, res) => {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { payload, source } = parsed.data;
    const result = analyze(payload);
    // Demo scans are labeled but stored in a separate logical bucket:
    // the dashboard counts only real (non-demo) scans.
    const id = db.insertScan({
      source,
      payloadRaw: payload,
      payloadType: result.payload.type,
      destination: result.payload.destination,
      normalized: result.payload.normalized,
      riskScore: result.riskScore,
      classification: result.classification,
      recommendation: result.recommendation,
      detectors: result.detectors.map((d) => ({
        detector: d.detector, label: d.label, category: d.category,
        triggered: d.triggered, severity: d.severity, score: d.score,
        explanation: d.explanation, evidence: d.evidence,
      })),
    });
    res.status(201).json({ id, source, ...result });
  }));

  // ---- decode image ------------------------------------------------------
  app.post("/api/decode", strictLimiter, wrap((req, res) => {
    const parsed = decodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { image, mimeType } = parsed.data;
    const comma = image.indexOf(",");
    const base64 = comma >= 0 ? image.slice(comma + 1) : image;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
      res.status(400).json({ error: "image must be base64-encoded" });
      return;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      res.status(400).json({ error: "image could not be base64-decoded" });
      return;
    }
    if (buffer.length > 6_000_000) {
      res.status(413).json({ error: "image too large" });
      return;
    }
    const result = decodeQrBuffer(buffer, mimeType);
    if (!result.ok) {
      res.status(422).json({ error: result.error, attempts: result.attempts });
      return;
    }
    res.json({ ok: true, text: result.text, attempts: result.attempts });
  }));

  // ---- optional AI explanation (never affects the deterministic score) --
  app.post("/api/ai/explain", strictLimiter, (req, res) => {
    explainFindings(req.body)
      .then((result) => {
        if ("error" in result) res.status(result.status).json({ error: result.error });
        else res.json(result);
      })
      .catch(() => res.status(500).json({ error: "Internal server error" }));
  });

  // ---- history -----------------------------------------------------------
  const listQuery = z.object({
    q: z.string().max(200).optional(),
    classification: z.enum(["ALL", "SAFE", "SUSPICIOUS", "DANGEROUS"]).default("ALL"),
    sort: z.enum(["newest", "oldest", "risk_desc", "risk_asc"]).default("newest"),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/api/history", wrap((req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const { rows, total } = db.listScans(parsed.data);
    res.json({
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        source: r.source,
        payloadType: r.payload_type,
        destination: r.destination,
        normalized: r.normalized,
        payloadRaw: r.payload_raw,
        riskScore: r.risk_score,
        classification: r.classification,
        recommendation: r.recommendation,
      })),
    });
  }));

  app.delete("/api/history", wrap((_req, res) => {
    const deleted = db.clearScans();
    res.json({ deleted });
  }));

  // ---- single scan -------------------------------------------------------
  app.get("/api/scan/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid scan id" });
      return;
    }
    const found = db.getScan(id);
    if (!found) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    // The engine is deterministic: re-running on the stored raw payload gives
    // the full structured shape (payload details, breakdown, reasons) while
    // scores/verdict stay exactly as stored.
    const analysis = analyze(found.scan.payload_raw);
    res.json({
      id: found.scan.id,
      createdAt: found.scan.created_at,
      source: found.scan.source,
      payloadRaw: found.scan.payload_raw,
      payloadType: found.scan.payload_type,
      destination: found.scan.destination,
      normalized: found.scan.normalized,
      riskScore: found.scan.risk_score,
      classification: found.scan.classification,
      recommendation: found.scan.recommendation,
      payload: analysis.payload,
      analyzedAt: found.scan.created_at,
      breakdown: analysis.breakdown,
      reasons: analysis.reasons,
      triggered: analysis.detectors.filter((d) => d.triggered),
      detectors: found.detectors.map((d) => ({
        detector: d.detector,
        label: d.label,
        category: d.category,
        triggered: d.triggered === 1,
        severity: d.severity,
        score: d.score,
        explanation: d.explanation,
        evidence: JSON.parse(d.evidence_json || "[]"),
      })),
    });
  }));

  app.delete("/api/scan/:id", wrap((req, res) => deleteById(req, res)));

  // Spec §19 endpoint: DELETE /api/history/:id (same handler as /api/scan/:id)
  app.delete("/api/history/:id", wrap((req, res) => deleteById(req, res)));

  // ---- stats -------------------------------------------------------------
  app.get("/api/stats", wrap((_req, res) => {
    const s = db.stats();
    res.json(s);
  }));

  // ---- 404 + error handler ----------------------------------------------
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error("[qr-shield]", err.message);
    const message = status === 400 && err instanceof SyntaxError
      ? "Malformed JSON body"
      : status >= 500 ? "Internal server error" : err.message;
    res.status(status).json({ error: message });
  });

  return app;
}

export function startServer() {
  const db = new Database(DB_PATH);
  const app = createApp(db);
  const server = app.listen(PORT, () => {
    console.log(`QR SHIELD API listening on http://localhost:${PORT}`);
  });
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { app, db, server };
}
