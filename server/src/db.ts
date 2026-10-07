/**
 * SQLite persistence via node:sqlite (built into Node 22+, zero native deps).
 * Clean initialization + versioned migrations.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ScanRow {
  id: number;
  created_at: string;
  source: "camera" | "image" | "manual" | "demo" | "api";
  payload_raw: string;
  payload_type: string;
  destination: string;
  normalized: string;
  risk_score: number;
  classification: "SAFE" | "SUSPICIOUS" | "DANGEROUS";
  recommendation: string;
}

export interface DetectorRow {
  id: number;
  scan_id: number;
  detector: string;
  label: string;
  category: string;
  triggered: number;
  severity: string;
  score: number;
  explanation: string;
  evidence_json: string;
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_raw TEXT NOT NULL,
        payload_type TEXT NOT NULL,
        destination TEXT NOT NULL,
        normalized TEXT NOT NULL,
        risk_score INTEGER NOT NULL,
        classification TEXT NOT NULL,
        recommendation TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scans_classification ON scans(classification);

      CREATE TABLE IF NOT EXISTS detector_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        detector TEXT NOT NULL,
        label TEXT NOT NULL,
        category TEXT NOT NULL,
        triggered INTEGER NOT NULL,
        severity TEXT NOT NULL,
        score INTEGER NOT NULL,
        explanation TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_detectors_scan ON detector_results(scan_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export class Database {
  private db: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(resolve(filePath)), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    const row = this.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as
      | { v: number | null }
      | undefined;
    const current = row?.v ?? 0;
    for (const m of MIGRATIONS) {
      if (m.version > current) {
        this.db.exec(m.sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(m.version, new Date().toISOString());
      }
    }
  }

  // ---- scans -------------------------------------------------------------

  insertScan(data: {
    source: string;
    payloadRaw: string;
    payloadType: string;
    destination: string;
    normalized: string;
    riskScore: number;
    classification: string;
    recommendation: string;
    detectors: {
      detector: string; label: string; category: string; triggered: boolean;
      severity: string; score: number; explanation: string; evidence: string[];
    }[];
  }): number {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = this.db
        .prepare(
          `INSERT INTO scans (created_at, source, payload_raw, payload_type, destination, normalized, risk_score, classification, recommendation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          new Date().toISOString(), data.source, data.payloadRaw, data.payloadType,
          data.destination, data.normalized, data.riskScore, data.classification, data.recommendation,
        );
      const scanId = Number(result.lastInsertRowid);
      const insertDet = this.db.prepare(
        `INSERT INTO detector_results (scan_id, detector, label, category, triggered, severity, score, explanation, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of data.detectors) {
        insertDet.run(
          scanId, d.detector, d.label, d.category, d.triggered ? 1 : 0,
          d.severity, d.score, d.explanation, JSON.stringify(d.evidence),
        );
      }
      this.db.exec("COMMIT");
      return scanId;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
  }

  listScans(opts: {
    q?: string;
    classification?: string;
    sort?: "newest" | "oldest" | "risk_desc" | "risk_asc";
    limit: number;
    offset: number;
  }): { rows: ScanRow[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.q) {
      where.push("(destination LIKE ? OR payload_raw LIKE ? OR payload_type LIKE ?)");
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    if (opts.classification && opts.classification !== "ALL") {
      where.push("classification = ?");
      params.push(opts.classification);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM scans ${whereSql}`)
      .get(...params) as { c: number };
    const order =
      opts.sort === "oldest" ? "created_at ASC"
      : opts.sort === "risk_desc" ? "risk_score DESC, created_at DESC"
      : opts.sort === "risk_asc" ? "risk_score ASC, created_at DESC"
      : "created_at DESC";
    const rows = this.db
      .prepare(`SELECT * FROM scans ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as unknown as ScanRow[];
    return { rows, total: totalRow.c };
  }

  getScan(id: number): { scan: ScanRow; detectors: DetectorRow[] } | null {
    const scan = this.db.prepare("SELECT * FROM scans WHERE id = ?").get(id) as
      | ScanRow | undefined;
    if (!scan) return null;
    const detectors = this.db
      .prepare("SELECT * FROM detector_results WHERE scan_id = ? ORDER BY triggered DESC, score DESC, label ASC")
      .all(id) as unknown as DetectorRow[];
    return { scan, detectors };
  }

  deleteScan(id: number): boolean {
    const result = this.db.prepare("DELETE FROM scans WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  clearScans(): number {
    const result = this.db.prepare("DELETE FROM scans").run();
    return Number(result.changes);
  }

  stats(): {
    total: number; safe: number; suspicious: number; dangerous: number;
    threatsDetected: number; topThreats: { label: string; count: number }[];
    byDay: { day: string; total: number; safe: number; suspicious: number; dangerous: number }[];
    byType: { type: string; count: number }[];
    avgScore: number;
  } {
    const count = (cls: string) =>
      (this.db.prepare("SELECT COUNT(*) AS c FROM scans WHERE classification = ?").get(cls) as { c: number }).c;
    const total = (this.db.prepare("SELECT COUNT(*) AS c FROM scans").get() as { c: number }).c;
    const threatsDetected = (
      this.db.prepare("SELECT COUNT(*) AS c FROM detector_results WHERE triggered = 1").get() as { c: number }
    ).c;
    const topThreats = this.db
      .prepare(
        `SELECT label AS label, COUNT(*) AS count FROM detector_results
         WHERE triggered = 1 GROUP BY label ORDER BY count DESC LIMIT 6`,
      )
      .all() as unknown as { label: string; count: number }[];
    const byDay = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day,
                COUNT(*) AS total,
                SUM(CASE WHEN classification='SAFE' THEN 1 ELSE 0 END) AS safe,
                SUM(CASE WHEN classification='SUSPICIOUS' THEN 1 ELSE 0 END) AS suspicious,
                SUM(CASE WHEN classification='DANGEROUS' THEN 1 ELSE 0 END) AS dangerous
         FROM scans GROUP BY day ORDER BY day ASC LIMIT 30`,
      )
      .all() as unknown as { day: string; total: number; safe: number; suspicious: number; dangerous: number }[];
    const byType = this.db
      .prepare("SELECT payload_type AS type, COUNT(*) AS count FROM scans GROUP BY payload_type ORDER BY count DESC")
      .all() as unknown as { type: string; count: number }[];
    const avgRow = this.db.prepare("SELECT AVG(risk_score) AS a FROM scans").get() as { a: number | null };
    return {
      total,
      safe: count("SAFE"),
      suspicious: count("SUSPICIOUS"),
      dangerous: count("DANGEROUS"),
      threatsDetected,
      topThreats,
      byDay,
      byType,
      avgScore: avgRow.a === null ? 0 : Math.round(avgRow.a),
    };
  }

  // ---- settings ----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
