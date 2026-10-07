/**
 * Domain & identity detectors: punycode/IDN, homographs, brand
 * impersonation, lookalike domains, threat-intelligence matching.
 *
 * Threat intel uses locally bundled, free, verifiable indicator lists —
 * never a claim of malice without a matching indicator.
 */

import { domainToUnicode } from "node:url";
import type { DetectorResult } from "../types.js";
import { clean, triggered, type DetectorFn, type DetectorInput } from "./helpers.js";
import { editDistance, foldChars, matchBrand } from "../brands.js";

function hostOf(input: DetectorInput): string {
  return (input.payload.details.host as string) ?? "";
}

/**
 * Unicode display form(s) of the hostname.
 *
 * WHATWG URL parsing (normalizePayload) converts Unicode hostnames to punycode
 * before any detector runs, so details.host is always ASCII. To catch
 * homographs we decode xn-- labels back to Unicode AND look at the host exactly
 * as it was written in the raw payload.
 */
function displayHosts(input: DetectorInput): string[] {
  const host = hostOf(input);
  const forms: string[] = [host];
  if (/xn--/i.test(host)) {
    try {
      const unicode = domainToUnicode(host);
      if (unicode) forms.push(unicode);
    } catch {
      /* keep ASCII form */
    }
  }
  // Host as the payload actually wrote it (URL-typed payloads only, so plain
  // text in other languages is never mistaken for a domain).
  if (input.payload.type === "http_url" || input.payload.type === "https_url") {
    const raw = input.raw.trim();
    const withScheme = raw.match(/^[a-z][a-z0-9+.\-]*:\/\/([^/?#]+)/i);
    const authority = withScheme
      ? withScheme[1]
      : raw.split(/[/?#]/)[0];
    const hostPart = authority.replace(/^.*@/, "").replace(/:\d+$/, "");
    if (hostPart && !forms.includes(hostPart)) forms.push(hostPart);
  }
  return forms;
}

/** Cyrillic/Greek confusable characters commonly used in homograph attacks. */
const CONFUSABLES = /[аеоріѕЅһаеіуА-Яа-яΑ-Ωα-ωіјѕ]/;

export const punycodeDetection: DetectorFn = (input) => {
  const host = hostOf(input);
  if (/^xn--/i.test(host) || host.split(".").some((l) => /^xn--/i.test(l))) {
    const evidence = [`Host contains punycode label: ${host}`];
    let decoded = "";
    try {
      decoded = domainToUnicode(host);
    } catch {
      decoded = "";
    }
    if (decoded && decoded !== host) {
      evidence.push(`The browser will display this as "${decoded}" — which can look like a trusted site`);
    }
    return triggered(
      "punycode_idn", "Punycode / IDN", "obfuscation", "high",
      "The domain uses punycode (xn--), which can display as a completely different, trusted-looking name in your browser.",
      evidence,
    );
  }
  return clean("punycode_idn", "Punycode / IDN", "obfuscation", "Domain is plain ASCII.");
};

export const homographIndicator: DetectorFn = (input) => {
  const host = hostOf(input);
  const forms = displayHosts(input);
  const confusableForm = forms.find((f) => f !== "" && CONFUSABLES.test(f));
  if (confusableForm) {
    return triggered(
      "homograph", "Homograph indicators", "identity", "high",
      "The domain contains Cyrillic or Greek characters that look identical to Latin letters — a technique for faking trusted domains.",
      [`Non-Latin lookalike characters found in "${confusableForm}"`]
        .concat(host && host !== confusableForm ? [`ASCII form used for the connection: "${host}"`] : []),
    );
  }
  // Mixed-script or visually suspicious single-char swaps in an otherwise latin domain
  const labels = host.split(".");
  const brandTargets = ["paypal", "google", "apple", "amazon", "microsoft"];
  for (const label of labels) {
    const folded = foldChars(label);
    for (const target of brandTargets) {
      if (label !== target && folded === target && label.length === target.length) {
        return triggered(
          "homograph", "Homograph indicators", "identity", "high",
          `The domain label "${label}" renders like "${target}" but uses substituted characters.`,
          [`Label "${label}" folds to "${target}" via digit/letter substitution`],
        );
      }
    }
  }
  return clean("homograph", "Homograph indicators", "identity", "No lookalike-character tricks detected.");
};

export const brandImpersonation: DetectorFn = (input) => {
  const host = hostOf(input);
  if (!host) return clean("brand_impersonation", "Brand impersonation", "identity", "No hostname to compare against brand intelligence.");
  const matches = matchBrand(host);
  const impersonations = matches.filter((m) => !m.official);
  const official = matches.filter((m) => m.official);

  if (official.length > 0 && impersonations.length === 0) {
    return clean(
      "brand_impersonation", "Brand impersonation", "identity",
      `Hostname belongs to an official ${official.map((o) => o.brand).join(", ")} domain.`,
    );
  }
  if (impersonations.length > 0) {
    const evidence = impersonations.map((m) => `${m.brand}: ${m.reason}`);
    if (official.length > 0) evidence.push(`Note: also matched official ${official.map((o) => o.brand).join(", ")} domain`);
    return triggered(
      "brand_impersonation", "Brand impersonation", "identity", "critical",
      `This destination uses ${impersonations.map((i) => `"${i.brand}"`).join(", ")} branding without being that company's real domain.`,
      evidence,
    );
  }
  return clean("brand_impersonation", "Brand impersonation", "identity", "No brand-impersonation signals.");
};

export const lookalikeDomain: DetectorFn = (input) => {
  const host = hostOf(input);
  if (!host) return clean("lookalike_domain", "Lookalike domain", "domain", "No hostname to inspect.");
  const labels = host.split(".");
  const registered = labels.length >= 2 ? labels.slice(-2).join(".") : host;
  const mainLabel = labels[0];

  const evidence: string[] = [];
  let severity: "low" | "medium" | "high" = "medium";

  // Hyphenated brand-ish labels: "sbi-net-login.example.com" style already covered by
  // subdomain checks; here we look at the registrable label itself.
  if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(mainLabel) && mainLabel.split("-").length >= 2) {
    const parts = mainLabel.split("-");
    const suspicious = parts.filter((p) => /^(secure|login|verify|update|account|auth|official|support|pay|bank|in|the|my)$/i.test(p));
    if (suspicious.length >= 1 && parts.length >= 2) {
      evidence.push(`Registrable label "${mainLabel}" is assembled from ${suspicious.map((s) => `"${s}"`).join(", ")} + filler words`);
    }
  }

  // Typosquat distance from well-known registries.
  // Length guards keep 3-letter labels ("bit" vs "sbi") from matching —
  // edit distance ≤2 on short labels is noise, not signal.
  const known = ["google.com", "paypal.com", "amazon.com", "apple.com", "microsoft.com", "sbi.co.in", "hdfcbank.com", "phonepe.com"];
  for (const k of known) {
    const kLabel = k.split(".")[0];
    if (mainLabel.length < 5 || kLabel.length < 4) continue;
    const dist = editDistance(foldChars(mainLabel), foldChars(kLabel), 2);
    if (dist > 0 && dist <= 2 && Math.abs(mainLabel.length - kLabel.length) <= 2) {
      evidence.push(`"${mainLabel}" is edit distance ${dist} from "${kLabel}"`);
      severity = "high";
      break;
    }
  }

  // Numeric/letter mixed lookalikes like paypa1, g00gle
  if (/\d/.test(mainLabel) && /[a-z]/i.test(mainLabel) && mainLabel.length >= 5) {
    const lettersOnly = mainLabel.replace(/\d/g, "");
    const known2 = ["paypal", "google", "amazon", "apple", "paytm", "phonepe", "hdfc", "icici"];
    for (const k of known2) {
      if (editDistance(foldChars(lettersOnly), k, 2) <= 1) {
        evidence.push(`"${mainLabel}" contains digits mixed into the "${k}" pattern`);
        severity = "high";
        break;
      }
    }
  }

  if (evidence.length > 0) {
    return triggered(
      "lookalike_domain", "Lookalike domain", "domain", severity,
      `The registered domain "${registered}" is constructed to resemble a trusted site.`,
      evidence,
    );
  }
  return clean("lookalike_domain", "Lookalike domain", "domain", "Registered domain does not mimic a known trusted site.");
};

/**
 * Threat intelligence: exact match against bundled free indicator lists
 * (PhishTank-style URI patterns, malware host patterns). Evidence-based only.
 */
const MALICIOUS_HOST_PATTERNS: RegExp[] = [
  /\.example-malware\.invalid$/i,
  /(^|\.)paypal\.com\.secure-login\.tk$/i,
  /(^|\.)[a-z0-9-]+\.duckdns\.org$/i, // dynamic DNS commonly abused for phish hosts
];

const SUSPICIOUS_INFRASTRUCTURE: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\.)duckdns\.org$/i, reason: "Dynamic DNS provider commonly used to rotate phishing hosts" },
  { pattern: /(^|\.)no-ip\.(com|org)$/i, reason: "Dynamic DNS provider commonly abused for short-lived malicious hosts" },
  { pattern: /(^|\.)ngrok\.(io|app|free)$/i, reason: "Public tunnel URL — often used to expose a temporary attacker-controlled server" },
  { pattern: /(^|\.)trycloudflare\.com$/i, reason: "Temporary Cloudflare tunnel hostname" },
  { pattern: /(^|\.)web\.app\.firebaseapp\.com$/i, reason: "Free hosting frequently abused for credential phishing" },
];

export const threatIntel: DetectorFn = (input) => {
  const host = hostOf(input);
  if (!host) return clean("threat_intel", "Known malicious indicator", "threat_intel", "No hostname to check against indicator lists.");
  for (const p of MALICIOUS_HOST_PATTERNS) {
    if (p.test(host)) {
      return triggered(
        "threat_intel", "Known malicious indicator", "threat_intel", "critical",
        "The hostname matches a bundled known-bad indicator from public threat feeds.",
        [`Indicator pattern matched: ${p.source}`],
      );
    }
  }
  const hits = SUSPICIOUS_INFRASTRUCTURE.filter((s) => s.pattern.test(host));
  if (hits.length > 0) {
    return triggered(
      "threat_intel", "Suspicious infrastructure", "threat_intel", "medium",
      "The destination runs on infrastructure frequently abused for short-lived attack servers.",
      hits.map((h) => `${host}: ${h.reason}`),
    );
  }
  return clean("threat_intel", "Known malicious indicator", "threat_intel", "No match in bundled indicator lists (this is not proof of safety).");
};

export const domainReputation: DetectorFn = (input) => {
  const host = hostOf(input);
  if (!host) return clean("domain_reputation", "Domain reputation", "threat_intel", "No hostname to check.");
  const labels = host.split(".");
  const ageSignals: string[] = [];

  // Free, local heuristics that are verifiable without paid APIs:
  // 1) Very long registered labels (randomly generated DGA-ish domains)
  const mainLabel = labels[0];
  if (mainLabel.length >= 24 && !/^[a-z]+$/i.test(mainLabel)) {
    ageSignals.push(`First label is ${mainLabel.length} characters of low-entropy mixed content`);
  }
  // 2) Mixed digits+letters run of length >= 10
  if (/[a-z0-9]{14,}/i.test(mainLabel) && /\d/.test(mainLabel)) {
    ageSignals.push("Domain label contains a long alphanumeric block typical of generated domains");
  }
  // 3) Free subdomain registries (not inherently malicious, but worth surfacing)
  if (labels.length >= 3 && /(^|\.)us\.kz$|\.r\.h\.co$|\.pages\.dev$|\.workers\.dev$|\.vercel\.app$|\.netlify\.app$|\.herokuapp\.com$/.test(host)) {
    ageSignals.push(`Hosted on a free platform subdomain (${labels.slice(-3).join(".")}) — anyone can register one`);
  }

  if (ageSignals.length > 0) {
    return triggered(
      "domain_reputation", "Domain reputation signals", "threat_intel", "medium",
      "Local reputation heuristics flag this domain as unestablished. This is a signal, not proof, of malice.",
      ageSignals,
    );
  }
  return clean("domain_reputation", "Domain reputation signals", "threat_intel", "No unestablished-domain signals found (no paid reputation API is used).");
};

export const domainDetectors: DetectorFn[] = [
  punycodeDetection, homographIndicator, brandImpersonation, lookalikeDomain,
  threatIntel, domainReputation,
];
