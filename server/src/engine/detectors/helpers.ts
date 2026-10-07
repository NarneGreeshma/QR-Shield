import type { DetectorCategory, DetectorResult, Severity } from "../types.js";
import { SEVERITY_WEIGHT } from "../types.js";

export interface DetectorInput {
  raw: string;
  normalized: string;
  /** Structured payload from normalizePayload() */
  payload: import("../types.js").PayloadInfo;
}

export type DetectorFn = (input: DetectorInput) => DetectorResult;

/** Build a triggered detector result. */
export function triggered(
  detector: string,
  label: string,
  category: DetectorCategory,
  severity: Severity,
  explanation: string,
  evidence: string[],
  overrideScore?: number,
): DetectorResult {
  return {
    detector,
    label,
    category,
    triggered: true,
    severity,
    score: overrideScore ?? SEVERITY_WEIGHT[severity],
    explanation,
    evidence,
  };
}

/** Build a clean (not triggered) detector result. */
export function clean(
  detector: string,
  label: string,
  category: DetectorCategory,
  explanation: string,
): DetectorResult {
  return {
    detector,
    label,
    category,
    triggered: false,
    severity: "info",
    score: 0,
    explanation,
    evidence: [],
  };
}
