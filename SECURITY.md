# QR SHIELD — Security Notes

QR SHIELD is a **defensive** tool: it analyzes QR payloads and explains risk.
This document describes how the product itself is secured and what it can and
cannot guarantee.

## Trust model

| Component | Trust |
| --- | --- |
| Security engine + risk score | **Server-side only.** The browser sends payloads; it never computes, submits, or overrides a verdict. |
| SQLite database | Local file (`server/data/qrshield.db`), gitignored. Stores only structured scan records — no images, no credentials. |
| AI explanation | Optional, never authoritative. It receives structured findings only and has no write path to scores or the database. |
| Camera frames | Processed on-device in the browser (jsQR). Never uploaded, stored, or logged. |
| Secrets | Any provider key lives in a server environment variable (`QRSHIELD_AI_API_KEY`). No key is ever shipped to the client — the client only sees a boolean. |

## Enforced controls

- **Input validation** — zod on every endpoint: payload ≤ 8 KB, image ≤ 6 MB,
  bounded query params, enum-constrained filters. Malformed JSON → `400`.
- **Rate limiting** — 120 req/min per IP on `/api`, 30 req/min on
  `/api/decode` and `/api/ai/explain` (express-rate-limit, standard headers).
- **Headers** — `helmet` (CSP disabled only because the app serves its own
  SPA), `x-powered-by` removed, CORS restricted via `CORS_ORIGIN`.
- **No client-supplied verdicts** — `riskScore` / `classification` posted by a
  client are ignored; verified by an integration test.
- **Error handling** — errors return `{ error }` with proper status codes;
  server-side failures are logged, details are not leaked to clients.
- **Safe defaults for dangerous results** — dangerous destinations are not
  rendered as clickable links; payment payloads open only via the user's
  payment app, never automatically.
- **No outbound fetches by the engine** — detectors are pure functions over
  the payload. The product never visits a scanned URL (no SSRF surface).
- **Dependencies** — free, open-source only; no paid APIs, no telemetry,
  no third-party scripts in the frontend.

## What this tool does NOT guarantee

- A **SAFE** verdict is *not* proof a destination is harmless. Detection is
  signature/heuristic-based with bundled indicators; zero matches ≠ safe.
- It does not block navigation, sandbox pages, or inspect remote content.
- No live threat-intelligence feed is queried (no paid APIs); indicator
  coverage is local and may be stale.
- Scores are triage aids for a human decision, not a security guarantee.

## Reporting

This is a hackathon/educational project. If you find a vulnerability, open an
issue in the repository with reproduction steps rather than a public exploit.
