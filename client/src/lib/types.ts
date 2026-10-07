/** Types mirroring the QR SHIELD API contract (server is the source of truth). */

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Classification = "SAFE" | "SUSPICIOUS" | "DANGEROUS";
export type ScanSource = "camera" | "image" | "manual" | "demo" | "api";

export type PayloadType =
  | "http_url" | "https_url" | "upi_payment" | "crypto_payment"
  | "phone" | "email" | "sms" | "wifi" | "contact"
  | "text" | "unknown_uri" | "empty";

export type DetectorCategory =
  | "identity" | "url" | "domain" | "redirects"
  | "payments" | "obfuscation" | "social_engineering" | "threat_intel";

export interface DetectorResult {
  detector: string;
  label: string;
  category: DetectorCategory;
  triggered: boolean;
  severity: Severity;
  score: number;
  explanation: string;
  evidence: string[];
}

export interface PayloadInfo {
  type: PayloadType;
  destination: string;
  normalized: string;
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
  reasons: string[];
  recommendation: string;
  analyzedAt: string;
}

export interface ScanRecord extends AnalysisResult {
  id: number;
  source: ScanSource;
}

export interface ScanListItem {
  id: number;
  createdAt: string;
  source: ScanSource;
  payloadType: PayloadType;
  destination: string;
  normalized: string;
  payloadRaw: string;
  riskScore: number;
  classification: Classification;
  recommendation: string;
}

export interface HistoryResponse {
  total: number;
  limit: number;
  offset: number;
  items: ScanListItem[];
}

export interface StatsResponse {
  total: number;
  safe: number;
  suspicious: number;
  dangerous: number;
  threatsDetected: number;
  topThreats: { label: string; count: number }[];
  byDay: { day: string; total: number; safe: number; suspicious: number; dangerous: number }[];
  byType: { type: string; count: number }[];
  avgScore: number;
}
