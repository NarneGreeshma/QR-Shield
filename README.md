# QR SHIELD

> **PAUSE BEFORE YOU TAP**

A local-first QR code security platform. Decode a real QR code (camera, image, or
manual input), run it through a deterministic detection engine, and get an
**explainable** risk verdict — score, threats, evidence, and what to do next.

Free and open-source stack only. No paid APIs. No fake scan results. Core detection
works **without AI** (AI is optional and only rephrases findings).

---

## Quick start

Requirements: **Node.js 22+** (uses the built-in `node:sqlite`), npm.

```bash
npm install        # installs server + client workspaces
npm run dev        # API on :4000, web app on :5173
```

Open http://localhost:5173

| Command              | What it does                                  |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Run API + web app together                    |
| `npm test`           | Backend (43) + frontend (9) test suites        |
| `npm run typecheck`  | TypeScript checks for both workspaces         |
| `npm run build`      | Production build of server + client           |
| `npm start`          | Run the built server                          |

Data is stored in `server/data/qrshield.db` (SQLite, created automatically,
versioned migrations). Delete the file to reset.

---

## Architecture

```
┌─────────────── CLIENT (React + Vite + TS + Tailwind) ───────────────┐
│  camera (jsQR, rAF)   image upload (jsQR + preprocessing)   manual  │
│              │                    │                         │       │
│              └──────────── POST /api/scan ──────────────────┘       │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │  (payload only — no scores in)
┌────────────────────────── SERVER (Express + TS) ────────────────────┐
│  zod validation → rate limit → normalize → 23 detectors → scoring   │
│                              │                       │              │
│                        SQLite (scans, detector_results, settings)   │
└─────────────────────────────────────────────────────────────────────┘
```

Key rule: **the browser never computes or submits a risk score.** The client sends
only the decoded payload; the server returns the verdict. See `ARCHITECTURE.md`.

---

## Features

- **Real QR decoding** — live camera (rear camera preferred, auto-detect, pauses
  after a hit, full cleanup/teardown), PNG/JPG/WebP upload with
  grayscale/contrast/inversion fallbacks, and manual input for URLs/UPI/text.
- **Payload intelligence** — recognizes HTTPS/HTTP URLs, UPI, crypto, phone, email,
  SMS, WiFi, contact cards, plain text, and custom URIs; shows type, destination,
  and normalized value.
- **23 detectors** in 8 categories: identity, URL, domain, redirects, payments,
  obfuscation, social engineering, threat intel (see `Security Center` page).
- **Brand intelligence** — 18 configured brands with official-domain verification
  so legitimate domains are never falsely flagged.
- **Deterministic risk engine** — severity-weighted contributions
  (LOW +8 / MEDIUM +16 / HIGH +28 / CRITICAL +40, capped at 40 each), summed and
  capped at 100: **0–29 SAFE · 30–64 SUSPICIOUS · 65–100 DANGEROUS**. Same input →
  same score, always.
- **Explainable results** — every verdict shows *why it was flagged* (evidence per
  detector), *score composition*, and *what you should do*. Dangerous destinations
  are not offered as links.
- **Dashboard** — aggregates only real stored scans (totals, risk distribution,
  30-day trends, most common threats, recent scans).
- **History** — search, filter by verdict, sort, per-row delete, clear-all.
- **Security Analyst mode** — full pipeline view: payload → normalization →
  all detector results → score calculation → final verdict.
- **Demo mode** — 3 prepared cases (safe / phishing / UPI scam) run through the
  real engine via `/api/analyze` (never persisted, clearly labeled `DEMO TEST CASE`).
- **Privacy First** — camera frames processed on-device and never stored; only
  structured scan records go to local SQLite; no analytics; no keys in frontend.

---

## API

Base URL: `http://localhost:4000` (the Vite dev server proxies `/api`).

| Method   | Path                | Body / Query                                        | Returns |
| -------- | ------------------- | --------------------------------------------------- | ------- |
| `GET`    | `/api/health`       | —                                                   | status, `ai` flag, `scoring: "server-side"` |
| `POST`   | `/api/scan`         | `{ payload, source? }` — source: camera/image/manual/demo/api | `201` full analysis + `id` (persisted) |
| `POST`   | `/api/analyze`      | `{ payload }`                                       | full analysis, **not persisted** (demo/preview) |
| `POST`   | `/api/decode`       | `{ image (base64), mimeType }`                      | `{ ok, text, attempts }` or `422` |
| `POST`   | `/api/ai/explain`   | structured findings                                 | `{ explanation }` — only if `QRSHIELD_AI_API_KEY` set, else `503` |
| `GET`    | `/api/history`      | `q`, `classification`, `sort`, `limit`, `offset`    | `{ total, items[] }` |
| `GET`    | `/api/scan/:id`     | —                                                   | detail incl. every detector result |
| `DELETE` | `/api/scan/:id`     | —                                                   | `{ deleted: true }` |
| `DELETE` | `/api/history`      | —                                                   | `{ deleted: n }` (clear all) |
| `GET`    | `/api/stats`        | —                                                   | real aggregates from SQLite |

Validation: zod on every input (payload ≤ 8 KB, image ≤ 6 MB, bounded query params).
Malformed JSON → `400`. Rate limits: 120 req/min per IP (30 for decode/AI).
Errors always return `{ "error": "..." }`.

### Example

```bash
curl -X POST http://localhost:4000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"payload":"https://paypal-secure-login.example.com/verify"}'
```

---

## Security engine

`normalize → detect → score → explain`, all in `server/src/engine/`:

1. **Normalize** (`normalize.ts`) — percent-decode (bounded), classify payload type,
   parse URL/UPI fields, record each step.
2. **Detect** (`detectors/*.ts`) — 23 pure detectors, each returning
   `{ detector, label, category, triggered, severity, score, explanation, evidence }`.
   Detectors that don't apply return a *clean* result, so the analyst view always
   shows the complete matrix.
3. **Score** (`risk.ts`) — severity weights capped per detector, duplicate
   contributions de-duplicated, small amplification for multiple independent
   high-severity families, final cap 100, thresholds 30/65.
4. **Explain** (`analyze.ts`) — plain-language reasons (`+28 Login / authentication
   bait`), classification, and a recommendation that scales with verdict. Payment
   results always say *"verify the recipient before paying"* — a payee is never
   declared fraudulent without verified evidence.

**Optional AI** (`server/src/ai.ts`): set `QRSHIELD_AI_API_KEY` (and optionally
`QRSHIELD_AI_BASE_URL`, `QRSHIELD_AI_MODEL`) to enable *Explain this threat*.
The AI receives only structured findings, has a fixed system prompt that forbids
contradicting the score, and **cannot change the deterministic verdict**. Keys stay
server-side; the client only sees a boolean.

---

## Testing

```bash
npm test          # runs both suites below
```

- **Server (43 tests)** — engine cases required by spec: safe HTTPS, HTTP, raw IP,
  shortener, punycode, lookalike, brand impersonation (and *not* flagging official
  domains), login phishing, UPI/crypto payments, encoded URLs, suspicious ports,
  deep subdomains, malformed input, deterministic scoring; API integration tests
  (validation, persistence, history lifecycle, stats, 404/400 handling, server-side
  scoring); real QR round-trip decode tests (PNG, JPEG, inverted, non-QR error).
- **Client (9 tests)** — API client contract (payload-only posting, error mapping,
  query building, DELETE verbs) and image-decode input guards.

```bash
npm run typecheck # both workspaces
```

---

## Limitations

- **Threat intelligence is bundled, not live.** Indicator matching uses local,
  free patterns (dynamic DNS, tunnels, abuse-prone TLDs). There is no paid feed and
  no claim of malice without a matching indicator. A "clean" result is not proof of
  safety.
- **No HTTP redirect following.** Redirect analysis inspects the payload structure
  (chained URLs, open-redirect params); it does not fetch the destination.
- **No domain reputation API.** Reputation is heuristic (unestablished-domain
  signals), explicitly labeled as a signal, not proof.
- Camera scanning requires HTTPS or `localhost` (browser requirement) and a real
  device camera; image decoding requires a browser DOM (server-side `/api/decode`
  covers PNG/JPEG for API clients).
- `node:sqlite` prints an experimental warning (harmless).
- Scores are heuristics for triage, not a substitute for browser warnings.

## Future improvements

- Pluggable live feeds (Abuse.ch / URLhaus / PhishTank) with offline cache
- Real redirect-chain resolution behind an explicit, off-by-default setting
- Device-bound scan encryption at rest
- PWA offline support for manual/image analysis
- More brands, regional UPI handle intelligence, multilingual explanations
