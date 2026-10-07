/**
 * Duplicate-detection guard for live camera scanning.
 * Pure functions so the rule is unit-testable without a camera.
 */

export interface LastDetection {
  payload: string;
  at: number; // epoch ms
}

/**
 * An identical payload is suppressed while it stays "recently seen".
 * The camera loop refreshes `at` on every suppressed sighting, so a QR
 * that remains in view never re-fires; it re-arms only after being absent
 * for this long (deliberate re-scan: look away ~8s, then back).
 */
export const DUPLICATE_COOLDOWN_MS = 8000;

/**
 * Suppress only *identical* payloads whose last sighting is fresh.
 * A different payload always passes. Callers refresh `last.at` on every
 * suppressed sighting (refresh-on-suppress keeps a visible QR quiet).
 */
export function shouldSuppressDuplicate(
  payload: string,
  last: LastDetection | null,
  now: number,
  cooldownMs: number = DUPLICATE_COOLDOWN_MS,
): boolean {
  if (!last) return false;
  if (last.payload !== payload) return false;
  const age = now - last.at;
  return age >= 0 && age < cooldownMs;
}
