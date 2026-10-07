# QR SHIELD — Architecture

## Overview

QR SHIELD is a two-workspace npm monorepo: an Express API (`server/`) and a React
SPA (`client/`), connected by a REST contract implemented in `client/src/lib/api.ts`.
Everything runs locally with free, open-source technology — no paid APIs, no
telemetry, no external services required.

```
qr-shield/
├── package.json              # npm workspaces: server, client; dev/build/test scripts
├── server/                   # Express + TypeScript + SQLite
│   ├── src/
│   │   ├── index.ts          # entrypoint (startServer)
│   │   ├── app.ts            # Express app: routes, validation, rate limits, errors
│   │   ├── db.ts             # node:sqlite wrapper + versioned migrations
│   │   ├── decode.ts         # server-side QR image decoding (jsQR + pngjs/jpeg-js)
│   │   ├── ai.ts             # optional AI explanation (server-side key only)
│   │   └── engine/           # the security engine (pure, testable)
│   │       ├── types.ts      # DetectorResult, severity, classification, weights
│   │       ├── normalize.ts  # payload classification + normalization + steps
│   │       ├── brands.ts     # brand intelligence, edit distance, homograph folding
│   │       ├── risk.ts       # deterministic scoring, thresholds, recommendations
│   │       ├── analyze.ts    # orchestrator: normalize → detect → score → explain
│   │       └── detectors/    # helpers.ts, url.ts, domain.ts, payment.ts (23 detectors)
│   └── test/                 # engine, API, and real QR decode tests (vitest)
└── client/                   # React + Vite + TypeScript + Tailwind
    ├── src/
    │   ├── App.tsx           # shell, nav, lazy routes
    │   ├── lib/              # api.ts (REST client), types.ts, qrImage.ts, demoCases.ts
    │   ├── hooks/useQrCamera.ts   # rAF camera loop, throttled, full teardown
    │   ├── components/        # ScanWorkspace, ResultScreen, RiskMeter, AiExplain, ui
    │   └── pages/            # Scan, Dashboard, History, ScanDetail (analyst),
    │                         # SecurityCenter, Demo, Privacy
    └── vite.config.ts        # dev proxy /api → :4000, vitest config
```

## Core data flow

```
USER → QR INPUT (camera | image | manual)
     → RAW PAYLOAD STRING
     → POST /api/scan { payload, source }
     → zod validation → rate limit
     → normalizePayload()          (type, destination, parsed details, steps)
     → 23 detectors (pure functions, uniform envelope)
     → computeRiskScore()          (severity weights, per-detector cap 40, cap 100)
     → classify()                  (0–29 SAFE · 30–64 SUSPICIOUS · 65–100 DANGEROUS)
     → recommendation + reasons
     → persist (scans + detector_results) → return full analysis
     → RESULT SCREEN (verdict, meter, evidence, guidance)
```

## Key design decisions

1. **Server-side scoring.** The browser sends only `{ payload, source }`. A client
   that posts `riskScore`/`classification` is ignored — verified by tests. This
   removes an entire class of tampering.
2. **Pure detection core.** Every detector is `(DetectorInput) => DetectorResult`
   with no I/O, so all 23 detectors run on every payload regardless of type.
   Non-applicable detectors return `clean()`, which makes the Analyst mode a
   complete, honest matrix instead of a cherry-picked list.
3. **Deterministic scoring.** Fixed severity weights
   (info 0 / low 8 / medium 16 / high 28 / critical 40), per-detector cap 40,
   de-duplication of identical contributions, +5 amplification only for multiple
   independent high-severity families, final cap 100. Order-independent → the same
   payload always yields the same score (asserted in tests).
4. **Evidence over verdicts.** Detectors return `evidence: string[]`; the UI shows
   them verbatim under "Why this was flagged". Payment language is constrained to
   *"verify the recipient before paying"* — never an unverified fraud claim.
5. **Official domains short-circuit brand matching.** `paypal.com` can never flag
   as a Paytm lookalike; impersonation requires structural evidence (brand token in
   a non-official host, edit distance, homograph, lure vocabulary).
6. **Demo isolation.** Demo cases call `/api/analyze`, which performs no DB write,
   so prepared data can never pollute real history or dashboard statistics.
7. **Optional AI, never authoritative.** `ai.ts` receives structured findings only,
   uses a fixed system prompt that forbids contradicting the classification, and
   has no write path to the score or the database.

## Database schema (SQLite, `node:sqlite`)

| Table | Purpose |
| --- | --- |
| `scans` | id, created_at, source, payload_raw, payload_type, destination, normalized, risk_score, classification, recommendation |
| `detector_results` | one row per detector per scan: detector, label, category, triggered, severity, score, explanation, evidence_json (FK → scans, cascade delete) |
| `settings` | key/value store (reserved for future preferences) |
| `schema_migrations` | versioned migrations applied in order |

WAL mode and foreign keys are enabled. Migrations run automatically at startup.

## Performance & lifecycle

- Camera: `requestAnimationFrame` loop decoding at most every 200 ms, frames
  downscaled to ≤640 px before jsQR, detection pauses the loop, `stop()` cancels
  the frame and stops every track; unmount cleanup is registered — no timers or
  streams leak.
- Images: original resolution preserved; transforms are applied in-memory with no
  upscaling; oversized files rejected before decode.
- Client bundle: route-level `React.lazy` splitting (recharts confined to the
  dashboard chunk), initial chunk ≈113 KB gzip.
- Server: bounded payloads (8 MB JSON, 8 KB text), bounded query params,
  per-IP rate limits, timeouts on the optional AI fetch.

## Error handling

Every operation has loading / success / empty / error + retry states; camera
failures distinguish permission denied, no camera, and generic errors with
recoverable actions (retry, switch to upload). API errors always return
`{ error }` with an appropriate status (400 validation, 404 missing, 413/422
decode, 503 AI unavailable).
