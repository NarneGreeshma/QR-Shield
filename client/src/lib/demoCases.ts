/**
 * Prepared demo cases for judges.
 *
 * Rules (spec §17):
 *  - clearly labeled "DEMO TEST CASE"
 *  - never persisted: they go through POST /api/analyze (no DB write)
 *  - real engine, real score — nothing is hardcoded
 */

export interface DemoCase {
  id: string;
  title: string;
  blurb: string;
  payload: string;
  expect: "SAFE" | "SUSPICIOUS" | "DANGEROUS";
}

export const DEMO_CASES: DemoCase[] = [
  {
    id: "demo-safe",
    title: "Safe HTTPS URL",
    blurb: "A plain, well-formed HTTPS destination with no risk signals. Should classify SAFE.",
    payload: "https://example.com/products",
    expect: "SAFE",
  },
  {
    id: "demo-phish",
    title: "Phishing / impersonation URL",
    blurb:
      "A lookalike host carrying PayPal branding in a subdomain, HTTP scheme, login bait and redirect-style parameters. Should classify DANGEROUS.",
    payload: "http://paypal-secure-login.account-verify.example.tk/verify?redirect=https://login.example.net/session",
    expect: "DANGEROUS",
  },
  {
    id: "demo-upi",
    title: "Payment / UPI risk case",
    blurb:
      "A UPI request paying a free-email payee with an unusually high amount. The engine reports evidence and asks you to verify — it does not declare fraud.",
    payload: "upi://pay?pa=winner.reward@gmail.com&pn=Prize%20Claims&am=99999&tn=Claim%20your%20refund%20now",
    expect: "DANGEROUS",
  },
];
