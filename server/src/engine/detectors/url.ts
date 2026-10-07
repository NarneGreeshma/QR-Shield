/**
 * URL-structure detectors: scheme, ports, shorteners, subdomains,
 * suspicious TLDs, encoding, credentials, query params, downloads.
 */

import type { DetectorResult } from "../types.js";
import { clean, triggered, type DetectorFn, type DetectorInput } from "./helpers.js";

const SHORTENER_DOMAINS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "buff.ly", "cutt.ly",
  "cutt.us", "rb.gy", "shorturl.at", "t.ly", "s.id", "bl.ink", "lnkd.in", "rebrand.ly",
  "soo.gd", "v.gd", "zzz.tc", "trib.al", "ift.tt", "db.tt", "youtu.be", "amzn.to",
  "wa.me", "paytm.me", "phone.pe", "qr.ae", "shorte.st", "bc.vc", "adf.ly",
]);

const SUSPICIOUS_PORTS = new Set([
  "8080", "8443", "8000", "8888", "3000", "5000", "4444", "6666", "1337", "9999",
  "22", "23", "21", "25", "3389", "445", "1433", "6379", "11211",
]);

const SUSPICIOUS_TLDS = new Set([
  "zip", "mov", "xyz", "top", "click", "link", "gq", "tk", "ml", "cf", "ga", "work",
  "loan", "country", "stream", "download", "racing", "review", "science", "party",
  "pw", "cc", "su", "icu", "cam", "cash", "monster", "rest", "surf", "quest",
]);

const DOWNLOAD_EXTENSIONS = [
  "exe", "msi", "bat", "cmd", "ps1", "scr", "jar", "apk", "dmg", "app", "deb", "rpm",
  "vbs", "js", "hta", "com", "pif", "reg", "lnk", "iso", "img", "docm", "xlsm", "pptm",
];

const SUSPICIOUS_PARAM_NAMES = new Set([
  "redirect", "redirect_uri", "redirect_url", "url", "next", "return", "returnto",
  "return_to", "goto", "dest", "destination", "continue", "callback", "checkout_url",
  "payload", "data", "file", "path", "redir", "rurl", "target", "u", "q", "link",
]);

const LOGIN_KEYWORDS = [
  "login", "signin", "sign-in", "log-in", "verify", "verification", "account",
  "password", "passwd", "credential", "secure", "update", "confirm", "authenticate",
  "session", "wallet", "otp", "kyc", "unlock",
];

const URGENCY_WORDS = [
  "urgent", "immediately", "suspend", "suspended", "expired", "expire", "limited time",
  "act now", "last chance", "warning", "alert", "unusual activity", "failed",
  "failed delivery", "blocked", "locked", "verify now", "confirm now", "within 24",
  "final notice", "legal action", "winner", "congratulations", "prize", "free gift",
  "claim now", "refund", "overdue", "deactivate",
];

function getHostDetails(input: DetectorInput) {
  const d = input.payload.details;
  return {
    host: (d.host as string) ?? "",
    port: String(d.port ?? ""),
    protocol: (d.protocol as string) ?? "",
    path: (d.path as string) ?? "",
    query: (d.query as Record<string, string>) ?? {},
    subdomains: (d.subdomains as string[]) ?? [],
    registeredDomain: (d.registeredDomain as string) ?? "",
    tld: (d.tld as string) ?? "",
  };
}

export const httpsValidation: DetectorFn = (input) => {
  const { protocol } = getHostDetails(input);
  if (input.payload.type === "http_url" && protocol === "http") {
    return triggered(
      "https_validation", "HTTPS validation", "url", "medium",
      "The destination uses unencrypted HTTP. Anything you type there can be read or modified in transit.",
      [`Scheme is "http" for ${input.payload.destination}`],
    );
  }
  return clean("https_validation", "HTTPS validation", "url", "Destination uses HTTPS.");
};

export const rawIpUrl: DetectorFn = (input) => {
  const { host } = getHostDetails(input);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:]+\]$/i.test(host)) {
    return triggered(
      "raw_ip_url", "Raw IP address URL", "url", "high",
      "The link points at a bare IP address instead of a named website — common in phishing and drive-by malware hosts.",
      [`Host is the IP address "${host}"`],
    );
  }
  return clean("raw_ip_url", "Raw IP address URL", "url", "Destination uses a normal domain name.");
};

export const suspiciousPort: DetectorFn = (input) => {
  const { port, protocol } = getHostDetails(input);
  const isDefault = (protocol === "https" && (port === "443" || port === "")) || (protocol === "http" && (port === "80" || port === ""));
  if (!isDefault && port && SUSPICIOUS_PORTS.has(port)) {
    return triggered(
      "suspicious_port", "Suspicious port", "url", "medium",
      `Port ${port} is a non-standard port frequently used to bypass filters or host secondary services.`,
      [`Destination specifies port ${port}`],
    );
  }
  if (!isDefault && port) {
    return triggered(
      "suspicious_port", "Suspicious port", "url", "low",
      `The destination uses a non-standard port (${port}), which is unusual for a legitimate site.`,
      [`Destination specifies port ${port}`],
    );
  }
  return clean("suspicious_port", "Suspicious port", "url", "Destination uses the standard port.");
};

export const urlShortener: DetectorFn = (input) => {
  const { host, path } = getHostDetails(input);
  const bare = host.replace(/^www\./, "");
  if (SHORTENER_DOMAINS.has(bare)) {
    return triggered(
      "url_shortener", "URL shortener", "url", "medium",
      "Shortened links hide the real destination. You cannot tell where this goes until you open it.",
      [`"${bare}" is a URL shortening service`, `Short code path: ${path}`],
    );
  }
  return clean("url_shortener", "URL shortener", "url", "Destination is not a known URL shortener.");
};

export const excessiveSubdomains: DetectorFn = (input) => {
  const { host, subdomains } = getHostDetails(input);
  if (subdomains.length >= 4) {
    return triggered(
      "excessive_subdomains", "Excessive subdomains", "domain", "medium",
      `${subdomains.length} subdomains is unusually deep — attackers use deep subdomain chains to look authoritative or to dodge domain-based filters.`,
      [`Host: ${host}`, `Subdomain chain: ${subdomains.join(" . ")}`],
    );
  }
  const junk = subdomains.filter((s) => /^(secure|login|verify|account|update|confirm|auth|sso|portal|online|mail|service|support)$/i.test(s));
  if (junk.length > 0) {
    return triggered(
      "excessive_subdomains", "Deceptive subdomain labels", "domain", "medium",
      `The subdomain${junk.length > 1 ? "s" : ""} ${junk.map((j) => `"${j}"`).join(", ")} imitate${junk.length > 1 ? "" : "s"} a security or login page — a classic spoofing pattern.`,
      [`Host: ${host}`],
    );
  }
  return clean("excessive_subdomains", "Excessive subdomains", "domain", "Subdomain structure looks ordinary.");
};

export const suspiciousTld: DetectorFn = (input) => {
  const { tld, host } = getHostDetails(input);
  if (tld && SUSPICIOUS_TLDS.has(tld)) {
    return triggered(
      "suspicious_tld", "Suspicious TLD", "domain", "medium",
      `".${tld}" is a top-level domain heavily abused in disposable phishing campaigns.`,
      [`Registered host: ${host}`, `TLD ".${tld}" appears on blocklists of high-abuse domains`],
    );
  }
  return clean("suspicious_tld", "Suspicious TLD", "domain", `TLD ".${tld || "n/a"}" is not associated with high abuse rates.`);
};

export const urlObfuscation: DetectorFn = (input) => {
  const evidence: string[] = [];
  const raw = input.raw;
  const decoded = input.normalized;

  // Excessive percent-encoding
  const pctCount = (raw.match(/%[0-9a-f]{2}/gi) ?? []).length;
  if (pctCount >= 6) evidence.push(`${pctCount} percent-encoded byte sequences found in the payload`);

  // Long base64-ish blob in query
  if (/[?&][a-z0-9_]+=([A-Za-z0-9+/]{40,}={0,2})/.test(decoded)) {
    evidence.push("A long base64-style blob is embedded in a query parameter");
  }

  // Decimal / hex / octal encoded IP inside the URL
  if (/[?&](url|dest|target|redir|next|u|q|link|return)=\s*(https?%3a%2f%2f|https?:\/\/)?\d{6,}(&|$)/i.test(decoded) ||
      /[?&](url|dest|target|redir|next|u|q|link|return)=\s*0x[0-9a-f]+/i.test(decoded)) {
    evidence.push("A query parameter contains a numerically-encoded address");
  }

  // "@-trick" — credentials section before the real host
  if (/https?:\/\/[^/?#]+@/i.test(decoded)) {
    evidence.push('The "@" trick is used: text before "@" is not the real destination');
  }

  // Multiple nested URLs
  const urlMatches = decoded.match(/https?:\/\//gi) ?? [];
  if (urlMatches.length >= 2) {
    evidence.push(`Payload contains ${urlMatches.length} embedded URLs (nested redirect pattern)`);
  }

  // Excessively long URL
  if (decoded.length > 220) {
    evidence.push(`Total payload length is ${decoded.length} characters`);
  }

  if (evidence.length > 0) {
    return triggered(
      "url_obfuscation", "URL encoding / obfuscation", "obfuscation", "high",
      "The payload is deliberately encoded or packed to hide where it really leads.",
      evidence,
    );
  }
  return clean("url_obfuscation", "URL encoding / obfuscation", "obfuscation", "No obfuscation patterns detected.");
};

export const embeddedCredentials: DetectorFn = (input) => {
  const m = input.normalized.match(/^https?:\/\/([^/?#@]+)@/i);
  if (m) {
    return triggered(
      "embedded_credentials", "Embedded credentials", "url", "high",
      'The URL embeds a user:password style block before "@". Browsers show only what follows it, so the visible site can differ from the real one.',
      [`Credential-like section: "${m[1].slice(0, 40)}"`],
    );
  }
  return clean("embedded_credentials", "Embedded credentials", "url", "No embedded credentials in the URL.");
};

export const suspiciousQueryParams: DetectorFn = (input) => {
  const { query } = getHostDetails(input);
  const keys = Object.keys(query);
  const hits = keys.filter((k) => SUSPICIOUS_PARAM_NAMES.has(k.toLowerCase()));
  if (hits.length >= 1 && keys.length >= 1) {
    const evidence = hits.map((k) => `Parameter "${k}" = ${String(query[k]).slice(0, 80)}`);
    return triggered(
      "suspicious_query_params", "Suspicious query parameters", "url", hits.length >= 2 ? "medium" : "low",
      "The link carries redirect-style parameters that can bounce you to a second, unrelated site.",
      evidence,
    );
  }
  return clean("suspicious_query_params", "Suspicious query parameters", "url", "Query parameters look ordinary.");
};

export const downloadIndicator: DetectorFn = (input) => {
  const { path } = getHostDetails(input);
  const extMatch = path.match(/\.([a-z0-9]{1,5})(?:$|[?#])/i);
  if (extMatch && DOWNLOAD_EXTENSIONS.includes(extMatch[1].toLowerCase())) {
    return triggered(
      "download_indicator", "Download / file extension", "url", "high",
      `The link points directly at a ".${extMatch[1].toLowerCase()}" file — installing or opening it could run code on your device.`,
      [`File path: ${path}`],
    );
  }
  return clean("download_indicator", "Download / file extension", "url", "No executable download detected.");
};

export const loginBait: DetectorFn = (input) => {
  const haystack = `${input.payload.destination} ${input.normalized}`.toLowerCase();
  const hits = LOGIN_KEYWORDS.filter((k) => haystack.includes(k));
  if (hits.length >= 3) {
    return triggered(
      "login_bait", "Login / authentication bait", "social_engineering", "high",
      `The destination stacks ${hits.length} login-related terms — a strong signal of a credential-harvesting page.`,
      [`Keywords found: ${hits.map((h) => `"${h}"`).join(", ")}`],
    );
  }
  if (hits.length >= 1) {
    return triggered(
      "login_bait", "Login / authentication bait", "social_engineering", "medium",
      "The destination references account login or verification language.",
      [`Keywords found: ${hits.map((h) => `"${h}"`).join(", ")}`],
    );
  }
  return clean("login_bait", "Login / authentication bait", "social_engineering", "No login-bait language detected.");
};

export const urgencyLanguage: DetectorFn = (input) => {
  // Check both the raw payload and its percent-decoded form so encoded lures
  // ("Prize%20Claims") are still caught.
  const text = `${input.raw} ${input.normalized}`.toLowerCase();
  const hits = URGENCY_WORDS.filter((w) => text.includes(w));
  if (hits.length >= 2) {
    return triggered(
      "urgency_language", "Urgency / social-engineering language", "social_engineering", "high",
      `The message uses ${hits.length} pressure tactics designed to make you act before you think.`,
      [`Phrases found: ${hits.map((h) => `"${h}"`).join(", ")}`],
    );
  }
  if (hits.length === 1) {
    return triggered(
      "urgency_language", "Urgency / social-engineering language", "social_engineering", "medium",
      "The message uses pressure language to rush your decision.",
      [`Phrase found: "${hits[0]}"`],
    );
  }
  return clean("urgency_language", "Urgency / social-engineering language", "social_engineering", "No urgency tactics detected.");
};

export const suspiciousEmail: DetectorFn = (input) => {
  if (input.payload.type !== "email" && input.payload.type !== "sms") {
    return clean("suspicious_email_sms", "Suspicious email / SMS payload", "social_engineering", "Not an email or SMS payload.");
  }
  const text = input.raw.toLowerCase();
  const evidence: string[] = [];
  if (input.payload.type === "sms") {
    const body = String(input.payload.details.body ?? "");
    if (/\b(http|www\.|bit\.ly|tinyurl)\b/i.test(body)) evidence.push("SMS contains a link");
    if (/(verify|otp|bank|blocked|suspend|claim|reward|lottery|win)/i.test(body)) {
      evidence.push("SMS uses financial or verification language");
    }
    if (/\b(\d{4,})\b/.test(body) && /(otp|code|pin)/i.test(body)) evidence.push("SMS appears to request a one-time code");
  } else {
    const addr = String(input.payload.details.address ?? "");
    const domain = addr.split("@")[1] ?? "";
    if (/^\d+(\.\d+){3}$/.test(domain)) evidence.push(`Email sender uses a raw IP domain (${domain})`);
    if (/-(secure|verify|support|service|update|confirm)@/i.test(addr)) evidence.push("Local part of the address imitates a security notice");
    if (/\+/.test(addr)) evidence.push("Address uses plus-addressing to vary the sender");
  }
  if (evidence.length > 0) {
    return triggered(
      "suspicious_email_sms", "Suspicious email / SMS payload", "social_engineering", "medium",
      "The message payload carries patterns commonly used in smishing (SMS phishing) or business email compromise.",
      evidence,
    );
  }
  return clean("suspicious_email_sms", "Suspicious email / SMS payload", "social_engineering", "No smishing patterns detected.");
};

export const wifiCredentialRisk: DetectorFn = (input) => {
  if (input.payload.type !== "wifi") return clean("wifi_credentials", "WiFi credential payload", "url", "Not a WiFi payload.");
  const enc = String(input.payload.details.encryption ?? "").toLowerCase();
  if (enc === "nopass" || enc === "wep") {
    return triggered(
      "wifi_credentials", "WiFi credential payload", "url", "medium",
      `This QR shares ${enc === "wep" ? "a weak WEP" : "an open, unencrypted"} WiFi network. Joining it exposes your traffic to anyone nearby.`,
      [`SSID: ${input.payload.details.ssid ?? "unknown"}`, `Security: ${enc}`],
    );
  }
  return clean("wifi_credentials", "WiFi credential payload", "url", "WiFi payload requests a normally-secured network.");
};

/** All URL-structure detectors. */
export const urlDetectors: DetectorFn[] = [
  httpsValidation, rawIpUrl, suspiciousPort, urlShortener, excessiveSubdomains,
  suspiciousTld, urlObfuscation, embeddedCredentials, suspiciousQueryParams,
  downloadIndicator, loginBait, urgencyLanguage, suspiciousEmail, wifiCredentialRisk,
];
