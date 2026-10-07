/**
 * Payload classification + normalization.
 *
 * Runs before any detector so detectors operate on a structured payload
 * instead of raw text. Pure functions only.
 */

import type { PayloadInfo, PayloadType } from "./types.js";

const UPI_SCHEME = /^upi:/i;
const CRYPTO_SCHEMES = /^(bitcoin|ethereum|litecoin|dogecoin|monero|tron|bitcoincash):/i;
const KNOWN_SCHEMES = /^(https?|mailto|tel|sms|wifi|wpa|wep|upi|geo|ftp|file|intent|market|spotify|whatsapp|tg|slack|bitcoin|ethereum):/i;

export interface NormalizationStep {
  step: string;
  input: string;
  output: string;
  note?: string;
}

/** Decode percent-encoding repeatedly until stable (bounded). */
export function fullyDecode(value: string): { result: string; rounds: number } {
  let current = value;
  let rounds = 0;
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
      rounds++;
    } catch {
      break; // malformed percent-encoding — keep as-is
    }
  }
  return { result: current, rounds };
}

function classifyType(raw: string): PayloadType {
  const value = raw.trim();
  if (!value) return "empty";
  if (UPI_SCHEME.test(value)) return "upi_payment";
  if (CRYPTO_SCHEMES.test(value)) return "crypto_payment";
  const lower = value.toLowerCase();
  if (lower.startsWith("http://")) return "http_url";
  if (lower.startsWith("https://")) return "https_url";
  if (lower.startsWith("mailto:")) return "email";
  if (lower.startsWith("sms:")) return "sms";
  if (lower.startsWith("tel:")) return "phone";
  if (lower.startsWith("wifi:")) return "wifi";
  if (/^begin:vcard/i.test(value)) return "contact";
  if (KNOWN_SCHEMES.test(value)) return "unknown_uri";
  // Bare domain heuristics: example.com/path without scheme.
  // Unicode letters are included so bare internationalized (IDN) domains are
  // still treated as URLs and reach the punycode/homograph detectors.
  if (/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(\/|$|\?|#)/u.test(value) && !value.includes(" ")) {
    return "http_url";
  }
  return "text";
}

function parseUpi(value: string): Record<string, unknown> {
  const query = value.includes("?") ? value.slice(value.indexOf("?") + 1) : value.replace(/^upi:?/i, "");
  const params: Record<string, string> = {};
  for (const pair of query.split(/[&;]/)) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) params[k.toLowerCase()] = v;
  }
  const amountRaw = params.am ?? params.amt ?? params.amount;
  const amount = amountRaw ? Number(amountRaw) : undefined;
  return {
    payee: params.pa ?? params.payee ?? null,
    payeeName: params.pn ?? params.name ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: params.currency ?? "INR",
    transactionNote: params.tn ?? params.note ?? params.message ?? null,
    transactionRef: params.tr ?? params.txnid ?? null,
    merchantCode: params.merchantcode ?? null,
    responseUrl: params.url ?? null,
    params,
  };
}

/** Build the structured payload info from raw QR text. */
export function normalizePayload(raw: string): { payload: PayloadInfo; steps: NormalizationStep[] } {
  const steps: NormalizationStep[] = [];
  const original = raw ?? "";
  steps.push({ step: "Raw payload", input: "", output: original.slice(0, 400) });

  const trimmed = original.trim();
  const { result: decoded, rounds } = fullyDecode(trimmed);
  if (rounds > 0) {
    steps.push({
      step: "Percent-decoding",
      input: trimmed.slice(0, 400),
      output: decoded.slice(0, 400),
      note: `${rounds} decoding round(s) applied`,
    });
  }

  const type = classifyType(decoded);
  let destination = decoded;
  let normalized = decoded;
  const details: Record<string, unknown> = {};

  if (type === "http_url" || type === "https_url") {
    const withScheme = /^https?:\/\//i.test(decoded) ? decoded : `https://${decoded}`;
    try {
      const url = new URL(withScheme);
      // Normalize: lowercase scheme/host, drop default ports, keep path/query.
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      if (
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      ) {
        url.port = "";
      }
      destination = url.hostname + (url.port ? `:${url.port}` : "") + url.pathname + url.search;
      normalized = url.toString();
      details.host = url.hostname;
      details.port = url.port || (url.protocol === "https:" ? "443" : "80");
      details.protocol = url.protocol.replace(":", "");
      details.path = url.pathname;
      details.query = Object.fromEntries(url.searchParams.entries());
      details.subdomains = url.hostname.split(".").slice(0, -1);
      const parts = url.hostname.split(".");
      details.registeredDomain = parts.length >= 2 ? parts.slice(-2).join(".") : url.hostname;
      details.tld = parts.length >= 2 ? parts[parts.length - 1] : "";
      steps.push({
        step: "URL parse",
        input: withScheme.slice(0, 400),
        output: normalized.slice(0, 400),
        note: "host lowercased, default port removed",
      });
    } catch {
      details.parseError = true;
      steps.push({ step: "URL parse", input: withScheme.slice(0, 400), output: "", note: "URL could not be parsed" });
    }
  } else if (type === "upi_payment") {
    const parsed = parseUpi(decoded);
    Object.assign(details, parsed);
    destination = (details.payee as string) || "UPI payment request";
    normalized = decoded;
    steps.push({ step: "UPI parse", input: decoded.slice(0, 400), output: destination });
  } else if (type === "email") {
    const addr = decoded.replace(/^mailto:/i, "").split("?")[0];
    destination = addr;
    details.address = addr;
  } else if (type === "phone") {
    const num = decoded.replace(/^tel:/i, "");
    destination = num;
    details.number = num;
  } else if (type === "sms") {
    const rest = decoded.replace(/^sms:/i, "");
    const [num, body] = rest.split(":");
    destination = num || rest;
    details.number = num;
    details.body = body ?? null;
  } else if (type === "wifi") {
    const ssidMatch = decoded.match(/ssid:"?([^";]+)"?/i);
    const encMatch = decoded.match(/t:(wep|wpa|nopass)/i);
    destination = ssidMatch ? ssidMatch[1] : "WiFi network";
    details.ssid = ssidMatch?.[1] ?? null;
    details.encryption = encMatch?.[1] ?? null;
  } else if (type === "crypto_payment") {
    const [scheme, rest] = decoded.split(":");
    details.address = (rest ?? "").split("?")[0];
    details.scheme = scheme;
    destination = details.address ? `${scheme}:${String(details.address).slice(0, 24)}…` : scheme;
  } else if (type === "unknown_uri") {
    const scheme = decoded.split(":")[0];
    details.scheme = scheme;
    destination = decoded.slice(0, 120);
  } else {
    destination = decoded.slice(0, 160);
    details.length = decoded.length;
  }

  const payload: PayloadInfo = { type, destination, normalized, details };
  return { payload, steps };
}
