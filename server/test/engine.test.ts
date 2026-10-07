/**
 * Security engine test suite.
 * Required cases: safe HTTPS, HTTP, IP, shortener, punycode, lookalike,
 * brand impersonation, login phishing, UPI, encoded URL, suspicious port,
 * subdomains, malformed input.
 */

import { describe, expect, it } from "vitest";
import { analyze } from "../src/engine/analyze.js";
import { normalizePayload } from "../src/engine/normalize.js";
import { classify, computeRiskScore } from "../src/engine/risk.js";

const has = (r: ReturnType<typeof analyze>, d: string) =>
  r.detectors.find((x) => x.detector === d);

describe("payload normalization", () => {
  it("classifies https URLs", () => {
    const { payload } = normalizePayload("https://example.com/path?a=1");
    expect(payload.type).toBe("https_url");
    expect(payload.details.host).toBe("example.com");
  });

  it("classifies UPI payloads", () => {
    const { payload } = normalizePayload("upi://pay?pa=merchant@okhdfcbank&pn=Shop&am=100");
    expect(payload.type).toBe("upi_payment");
    expect(payload.details.payee).toBe("merchant@okhdfcbank");
    expect(payload.details.amount).toBe(100);
  });

  it("classifies plain text and unknown schemes", () => {
    expect(normalizePayload("hello world").payload.type).toBe("text");
    expect(normalizePayload("geo:12,34").payload.type).toBe("unknown_uri");
    expect(normalizePayload("").payload.type).toBe("empty");
  });

  it("adds https scheme to bare domains", () => {
    const { payload } = normalizePayload("example.com/login");
    expect(payload.type).toBe("http_url");
    expect(payload.details.host).toBe("example.com");
  });
});

describe("risk scoring", () => {
  it("is deterministic for the same input", () => {
    const a = analyze("https://paypal-secure-login.example.com/verify");
    const b = analyze("https://paypal-secure-login.example.com/verify");
    expect(a.riskScore).toBe(b.riskScore);
    expect(a.classification).toBe(b.classification);
    expect(a.reasons).toEqual(b.reasons);
  });

  it("caps at 100 and classifies correctly", () => {
    const r = analyze("http://192.168.1.1:8080/login/verify/update/confirm@phish.example.tk");
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(100);
    expect(["SUSPICIOUS", "DANGEROUS"]).toContain(r.classification);
  });

  it("classify thresholds match spec", () => {
    expect(classify(0)).toBe("SAFE");
    expect(classify(29)).toBe("SAFE");
    expect(classify(30)).toBe("SUSPICIOUS");
    expect(classify(64)).toBe("SUSPICIOUS");
    expect(classify(65)).toBe("DANGEROUS");
    expect(classify(100)).toBe("DANGEROUS");
  });

  it("score is bounded per detector", () => {
    const fake = [
      { detector: "x", label: "X", category: "url" as const, triggered: true,
        severity: "critical" as const, score: 999, explanation: "", evidence: [] },
    ];
    const { score, breakdown } = computeRiskScore(fake);
    expect(breakdown[0].score).toBeLessThanOrEqual(40);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("detector cases", () => {
  it("SAFE: plain HTTPS URL scores low", () => {
    const r = analyze("https://example.com/about");
    expect(r.payload.type).toBe("https_url");
    expect(r.classification).toBe("SAFE");
    expect(r.riskScore).toBeLessThan(30);
  });

  it("triggers HTTP-only destination", () => {
    const r = analyze("http://example.com/login");
    expect(has(r, "https_validation")?.triggered).toBe(true);
    expect(r.classification).not.toBe("SAFE");
  });

  it("triggers raw IP URL", () => {
    const r = analyze("http://203.0.113.45/account");
    expect(has(r, "raw_ip_url")?.triggered).toBe(true);
    expect(has(r, "raw_ip_url")?.severity).toBe("high");
  });

  it("triggers URL shortener", () => {
    const r = analyze("https://bit.ly/3xYzAbC");
    const d = has(r, "url_shortener");
    expect(d?.triggered).toBe(true);
    expect(d?.evidence.join(" ")).toContain("bit.ly");
  });

  it("triggers punycode", () => {
    const r = analyze("https://xn--pypal-4ve.com/secure");
    expect(has(r, "punycode_idn")?.triggered).toBe(true);
  });

  it("triggers brand impersonation but never flags the official domain", () => {
    const bad = analyze("https://paypal-secure-login.example.com/verify");
    const d = has(bad, "brand_impersonation");
    expect(d?.triggered).toBe(true);
    expect(d?.evidence.join(" ")).toMatch(/PayPal/i);
    expect(bad.classification).toBe("DANGEROUS");

    const good = analyze("https://www.paypal.com/signin");
    expect(has(good, "brand_impersonation")?.triggered).toBe(false);
    expect(good.classification).toBe("SAFE");
  });

  it("triggers lookalike domain (typosquat)", () => {
    const r = analyze("https://paypa1.com/login");
    expect(has(r, "lookalike_domain")?.triggered).toBe(true);
  });

  it("triggers login phishing bait", () => {
    const r = analyze("https://account-verify-login.update-secure.example.com/signin");
    expect(has(r, "login_bait")?.triggered).toBe(true);
  });

  it("triggers suspicious port", () => {
    const r = analyze("https://example.com:8443/portal");
    const d = has(r, "suspicious_port");
    expect(d?.triggered).toBe(true);
    expect(d?.evidence.join(" ")).toContain("8443");
  });

  it("triggers excessive subdomains", () => {
    const r = analyze("https://a.b.c.d.example.com/x");
    expect(has(r, "excessive_subdomains")?.triggered).toBe(true);
  });

  it("triggers URL obfuscation on encoded payloads", () => {
    const encoded = "https%3A%2F%2Fexample.com%2Fpath%3Fnext%3Dhttps%253A%252F%252Fevil.example.net%252Fa";
    const r = analyze(encoded);
    expect(has(r, "url_obfuscation")?.triggered).toBe(true);
  });

  it("triggers embedded credentials", () => {
    const r = analyze("https://user:pass@example.com@evil.example.com/");
    expect(has(r, "embedded_credentials")?.triggered).toBe(true);
  });
});

describe("payment detection", () => {
  it("flags UPI payment requests and advises verification, not fraud claims", () => {
    const r = analyze("upi://pay?pa=merchant@okhdfcbank&pn=Known%20Merchant&am=250&cu=INR");
    expect(r.payload.type).toBe("upi_payment");
    const d = has(r, "upi_payment_risk");
    expect(d?.triggered).toBe(true);
    expect(d?.explanation).toMatch(/verify the recipient/i);
    expect(d?.explanation).not.toMatch(/fraudulent/i);
  });

  it("escalates risky UPI payees", () => {
    const r = analyze("upi://pay?pa=winner.reward@gmail.com&am=99999");
    const d = has(r, "upi_payment_risk");
    expect(d?.triggered).toBe(true);
    expect(["high", "critical"]).toContain(d?.severity);
  });

  it("detects crypto payment payloads", () => {
    const r = analyze("bitcoin:bc1qexampleaddress?amount=0.5");
    expect(r.payload.type).toBe("crypto_payment");
    expect(has(r, "crypto_payment")?.triggered).toBe(true);
  });
});

describe("malformed input safety", () => {
  it("never throws on garbage input", () => {
    const samples = ["%E0%A4%A", "http://", "://", "%%%", "upi://", "https://[", "a".repeat(5000)];
    for (const s of samples) {
      expect(() => analyze(s)).not.toThrow();
      const r = analyze(s);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeLessThanOrEqual(100);
    }
  });

  it("produces explanations only for triggered detectors", () => {
    const r = analyze("https://example.com");
    for (const d of r.detectors) {
      if (!d.triggered) {
        expect(d.score).toBe(0);
        expect(d.evidence).toHaveLength(0);
      } else {
        expect(d.explanation.length).toBeGreaterThan(0);
      }
    }
    expect(r.reasons).toHaveLength(r.breakdown.length);
  });
});

describe("Phase 2: identity & deception detectors", () => {
  it("triggers homograph detection on a Cyrillic lookalike domain", () => {
    // "раypal.com" — Cyrillic "р" and "а" render like Latin "r" and "a"
    const r = analyze("https://раypal.com/login");
    const d = has(r, "homograph");
    expect(d?.triggered).toBe(true);
    expect(d?.severity).toBe("high");
    const evidence = d?.evidence.join(" ") ?? "";
    expect(evidence).toMatch(/[а-яА-Я]/); // decoded Unicode form is shown
    expect(evidence).toContain("xn--");   // ASCII connection form is shown too
    expect(has(r, "punycode_idn")?.triggered).toBe(true);
    expect(r.classification).toBe("DANGEROUS");
  });

  it("triggers homograph detection on a bare IDN domain without a scheme", () => {
    const r = analyze("раypal.com/login");
    expect(r.payload.type).toBe("http_url");
    expect(has(r, "homograph")?.triggered).toBe(true);
    expect(has(r, "punycode_idn")?.triggered).toBe(true);
  });

  it("decodes punycode labels and reports the browser display form", () => {
    const r = analyze("https://xn--pypal-4ve.com/secure");
    const d = has(r, "punycode_idn");
    expect(d?.triggered).toBe(true);
    expect(d?.evidence.join(" ")).toContain("xn--pypal-4ve.com");
    expect(d?.evidence.join(" ")).toMatch(/display/i);
    expect(has(r, "homograph")?.triggered).toBe(true);
  });

  it("flags digit-substituted labels (paypa1 folds to paypal)", () => {
    const r = analyze("https://paypa1.com/login");
    const d = has(r, "homograph");
    expect(d?.triggered).toBe(true);
    expect(d?.evidence.join(" ")).toContain("paypal");
  });

  it("does not flag ordinary ASCII domains as homographs", () => {
    expect(has(analyze("https://example.com/about"), "homograph")?.triggered).toBe(false);
    expect(has(analyze("https://www.paypal.com/signin"), "homograph")?.triggered).toBe(false);
  });

  it("does not typosquat-match short labels (bit.ly is not an SBI lookalike)", () => {
    const r = analyze("https://bit.ly/3x");
    expect(has(r, "url_shortener")?.triggered).toBe(true);
    expect(has(r, "lookalike_domain")?.triggered).toBe(false);
    expect(r.classification).toBe("SAFE");
  });
});

describe("Phase 2: redirect / download / social-engineering detectors", () => {
  it("flags open-redirect parameters as a redirect chain", () => {
    const r = analyze("https://example.com/click?redirect=https://other.test/x");
    const d = has(r, "redirect_chain");
    expect(d?.triggered).toBe(true);
    const ev = d?.evidence.join(" ") ?? "";
    expect(ev).toContain("redirect");
    expect(ev).toContain("other.test");
  });

  it("flags direct executable downloads and stays clean on pages", () => {
    const bad = analyze("https://evil.example.com/file.apk");
    const d = has(bad, "download_indicator");
    expect(d?.triggered).toBe(true);
    expect(d?.severity).toBe("high");
    expect(d?.evidence.join(" ")).toContain("file.apk");
    expect(has(analyze("https://example.com/blog/post"), "download_indicator")?.triggered).toBe(false);
  });

  it("flags urgency / social-engineering language", () => {
    const r = analyze("https://example.com/?msg=urgent+suspended+verify+now");
    const d = has(r, "urgency_language");
    expect(d?.triggered).toBe(true);
    expect(d?.severity).toBe("high");
    expect(d?.evidence.join(" ")).toContain("urgent");
    expect(has(analyze("https://example.com/about"), "urgency_language")?.triggered).toBe(false);
  });

  it("flags high-abuse TLDs", () => {
    expect(has(analyze("https://free.example.zip/download"), "suspicious_tld")?.triggered).toBe(true);
    expect(has(analyze("https://example.com/x"), "suspicious_tld")?.triggered).toBe(false);
  });

  it("flags redirect-style query parameters", () => {
    const r = analyze("https://example.com/?url=http://bad.test/a&next=https://x.test");
    const d = has(r, "suspicious_query_params");
    expect(d?.triggered).toBe(true);
    const ev = d?.evidence.join(" ") ?? "";
    expect(ev).toContain("url");
    expect(ev).toContain("next");
  });

  it("flags suspicious infrastructure from bundled indicators", () => {
    expect(has(analyze("https://duckdns.org/phish"), "threat_intel")?.triggered).toBe(true);
    expect(has(analyze("https://ngrok.app/tunnel"), "threat_intel")?.triggered).toBe(true);
    expect(has(analyze("https://example.org/x"), "threat_intel")?.triggered).toBe(false);
  });
});

describe("Phase 2: scoring contract", () => {
  it("every triggered detector returns reason + evidence + score contribution", () => {
    const samples = [
      "https://раypal.com/login",
      "http://192.0.2.7:8080/x",
      "https://example.com/click?redirect=https://other.test/x",
      "https://evil.example.com/file.apk",
      "https://example.com/?msg=urgent+suspended+verify+now",
      "upi://pay?pa=prize.winner@gmail.com&am=99999&tn=urgent%20refund",
      "https://bit.ly/3x",
      "https://example.com/about",
      "hello world",
    ];
    for (const s of samples) {
      const r = analyze(s);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeLessThanOrEqual(100);
      expect(r.classification).toBe(classify(r.riskScore));
      for (const d of r.detectors) {
        if (d.triggered) {
          expect(d.explanation.length).toBeGreaterThan(0);
          expect(d.evidence.length).toBeGreaterThan(0);
          expect(d.score).toBeGreaterThan(0);
        }
      }
      expect(r.reasons).toHaveLength(r.breakdown.length);
    }
  });
});
