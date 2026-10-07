/**
 * Analysis orchestrator: normalize → run all detectors → score → explain.
 */

import type { AnalysisResult, DetectorResult } from "./types.js";
import { normalizePayload } from "./normalize.js";
import { urlDetectors } from "./detectors/url.js";
import { domainDetectors } from "./detectors/domain.js";
import { paymentDetectors } from "./detectors/payment.js";
import { buildReasons, classify, computeRiskScore, recommendationFor } from "./risk.js";
import type { DetectorFn } from "./detectors/helpers.js";

export const ALL_DETECTORS: DetectorFn[] = [
  ...urlDetectors,
  ...domainDetectors,
  ...paymentDetectors,
];

/** Deterministically analyze a raw QR payload. */
export function analyze(rawPayload: string): AnalysisResult {
  const { payload } = normalizePayload(rawPayload);

  // Detectors that don't apply to the payload type return clean() results,
  // so the full detector matrix is always visible in Analyst mode.
  const detectors: DetectorResult[] = ALL_DETECTORS.map((fn) =>
    fn({ raw: rawPayload, normalized: payload.normalized, payload }),
  );

  const triggered = detectors.filter((d) => d.triggered);
  const { score, breakdown } = computeRiskScore(triggered);
  const classification = classify(score);

  return {
    payload,
    detectors,
    triggered,
    riskScore: score,
    classification,
    breakdown,
    reasons: buildReasons(breakdown),
    recommendation: recommendationFor(classification, payload.type),
    analyzedAt: new Date().toISOString(),
  };
}
