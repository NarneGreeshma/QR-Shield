/**
 * Deterministic risk scoring.
 *
 * Rules:
 *  - Detectors are weighted by severity (see SEVERITY_WEIGHT).
 *  - Detector contributions are capped so one noisy detector can't max the score.
 *  - A small number of critical signals can still push a URL to DANGEROUS.
 *  - Score is capped at 100. Same input always produces the same score.
 */

import type { AnalysisResult, Classification, DetectorResult, RiskBreakdownItem } from "./types.js";
import { SEVERITY_WEIGHT } from "./types.js";

/** Max contribution per detector keeps scoring explainable and bounded.
 *  40 = full CRITICAL weight (spec: CRITICAL = +35 and above). */
const MAX_PER_DETECTOR = 40;

/** Classification thresholds (inclusive lower bound). */
export function classify(score: number): Classification {
  if (score >= 65) return "DANGEROUS";
  if (score >= 30) return "SUSPICIOUS";
  return "SAFE";
}

/**
 * Aggregate triggered detectors into a 0-100 score.
 * Order-independent → deterministic for the same detector set.
 */
export function computeRiskScore(triggered: DetectorResult[]): {
  score: number;
  breakdown: RiskBreakdownItem[];
} {
  const items: RiskBreakdownItem[] = [];
  let total = 0;

  for (const d of triggered) {
    const base = SEVERITY_WEIGHT[d.severity];
    // Prefer detector-provided score but never exceed the severity cap.
    const contribution = Math.min(Math.max(d.score, 0), Math.max(base, MAX_PER_DETECTOR));
    const capped = Math.min(contribution, MAX_PER_DETECTOR);
    if (capped <= 0) continue;
    items.push({ detector: d.detector, label: d.label, severity: d.severity, score: capped });
    total += capped;
  }

  // Two or more independent high-severity families amplify confidence slightly.
  const criticals = items.filter((i) => i.severity === "critical").length;
  const highs = items.filter((i) => i.severity === "high").length;
  if (criticals >= 1 && highs >= 2) total += 5;
  else if (criticals >= 2) total += 5;

  // Deduplicate near-identical contributions (same label+score) to avoid double counting
  const seen = new Map<string, RiskBreakdownItem>();
  const deduped: RiskBreakdownItem[] = [];
  for (const item of items) {
    const key = `${item.label}:${item.score}`;
    if (seen.has(key)) continue;
    seen.set(key, item);
    deduped.push(item);
  }
  if (deduped.length !== items.length) {
    total = deduped.reduce((s, i) => s + i.score, 0);
    if (criticals >= 1 && highs >= 2) total += 5;
    else if (criticals >= 2) total += 5;
  }

  // Sort breakdown by contribution desc, then label — stable output.
  deduped.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return { score: Math.max(0, Math.min(100, Math.round(total))), breakdown: deduped };
}

/** Build plain-language reasons from the breakdown. */
export function buildReasons(breakdown: RiskBreakdownItem[]): string[] {
  return breakdown.map((b) => `+${b.score} ${b.label}`);
}

/** Recommendation text scales with classification. */
export function recommendationFor(classification: Classification, payloadType: string): string {
  const isPayment = payloadType === "upi_payment" || payloadType === "crypto_payment";
  switch (classification) {
    case "DANGEROUS":
      return isPayment
        ? "Do not pay. Do not enter your UPI PIN, card or OTP. Independently verify the recipient using the official app or a phone number you already trust."
        : "Do not open this link and do not enter credentials or payment information. If you already did, change your password and contact your bank.";
    case "SUSPICIOUS":
      return isPayment
        ? "Payment request detected — verify the recipient before paying. Check the payee name in your own UPI app and confirm with the merchant directly."
        : "Pause before you tap. Verify the sender through an independent channel (official website or a number you already have) before opening this link.";
    case "SAFE":
    default:
      return isPayment
        ? "No high-risk signals found, but always confirm the payee name shown in your payment app before approving a transaction."
        : "No significant risk signals found. Standard caution still applies — never share passwords or OTPs on a page you reached by scanning.";
  }
}
