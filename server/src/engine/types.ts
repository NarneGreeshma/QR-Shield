/**
 * Core types for the QR Shield security engine.
 *
 * Every detector is pure and side-effect free, and returns the same envelope
 * so the risk engine and the UI can treat them uniformly.
 */

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Classification = "SAFE" | "SUSPICIOUS" | "DANGEROUS";

export type PayloadType =
  | "http_url"
  | "https_url"
  | "upi_payment"
  | "crypto_payment"
  | "phone"
  | "email"
  | "sms"
  | "wifi"
  | "contact"
  | "text"
  | "unknown_uri"
  | "empty";

export interface DetectorResult {
  /** Stable detector id, e.g. "https_validation" */
  detector: string;
  /** Human readable detector name */
  label: string;
  /** Category used by the Security Center page */
  category: DetectorCategory;
  triggered: boolean;
  severity: Severity;
  /** Deterministic score contribution, 0 when not triggered */
  score: number;
  /** One-line explanation understandable by a non-expert */
  explanation: string;
  /** Concrete evidence strings (the "why") */
  evidence: string[];
}

export type DetectorCategory =
  | "identity"
  | "url"
  | "domain"
  | "redirects"
  | "payments"
  | "obfuscation"
  | "social_engineering"
  | "threat_intel";

/** Structured description of the decoded payload. */
export interface PayloadInfo {
  type: PayloadType;
  /** What the user should read as "destination" */
  destination: string;
  /** Canonical/normalized value used for analysis */
  normalized: string;
  /** Parsed details (params, host, payee, amount, ...) */
  details: Record<string, unknown>;
}

export interface RiskBreakdownItem {
  detector: string;
  label: string;
  severity: Severity;
  score: number;
}

export interface AnalysisResult {
  payload: PayloadInfo;
  detectors: DetectorResult[];
  triggered: DetectorResult[];
  riskScore: number;
  classification: Classification;
  breakdown: RiskBreakdownItem[];
  /** Plain-language reasons shown under the score */
  reasons: string[];
  /** "What you should do" guidance */
  recommendation: string;
  analyzedAt: string;
}

/** Severity -> base weight used by the risk engine. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 8,
  medium: 16,
  high: 28,
  critical: 40,
};
