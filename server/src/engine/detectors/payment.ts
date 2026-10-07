/**
 * Payment detectors: UPI payloads, cryptocurrency, payment fraud signals.
 *
 * Language rule: we never declare a payee fraudulent. We say
 * "verify the recipient before paying" unless we have verified evidence.
 */

import type { DetectorResult } from "../types.js";
import { clean, triggered, type DetectorFn, type DetectorInput } from "./helpers.js";

const UPI_VPA = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-]+(\.[a-zA-Z]{2,})?$/;
const FREE_MAIL_VPA_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "rediffmail.com", "protonmail.com"];
const TOP_LEVEL_VPA = ["ybl", "okaxis", "okhdfcbank", "okicici", "oksbi", "paytm", "phonepe", "googlepay", "axisbank", "ibl", "axl", "upi"];

export const upiPaymentRisk: DetectorFn = (input) => {
  if (input.payload.type !== "upi_payment") {
    return clean("upi_payment_risk", "Payment (UPI) indicators", "payments", "Not a UPI payment payload.");
  }
  const d = input.payload.details;
  const evidence: string[] = [];
  let severity: DetectorResult["severity"] = "low";
  const payee = String(d.payee ?? "");
  const amount = d.amount === null || d.amount === undefined ? null : Number(d.amount);

  if (!payee) {
    evidence.push("No payee address (pa) parameter — you cannot see who receives the money");
    severity = "high";
  } else if (!UPI_VPA.test(payee)) {
    evidence.push(`Payee "${payee.slice(0, 60)}" is not a well-formed UPI ID`);
    severity = "medium";
  } else {
    const [local, domainPart] = payee.split("@");
    // Payee is a plain email address instead of a bank/PSP VPA
    if (FREE_MAIL_VPA_DOMAINS.includes(domainPart.toLowerCase())) {
      evidence.push(`Payee "${payee}" uses a free email provider as the UPI handle — legitimate merchants use bank/PSP handles`);
      severity = "high";
    }
    // Personal-sounding VPA rather than a merchant handle
    if (/^(upi|okaxis|okhdfcbank|okicici|oksbi)$/i.test(domainPart) === false && TOP_LEVEL_VPA.includes(domainPart.toLowerCase()) === false) {
      // unknown PSP — informational only, don't escalate
      evidence.push(`Payee handle domain "${domainPart}" is not a well-known PSP handle (informational)`);
    }
    if (/(secure|verify|kyc|update|refund|bonus|gift|prize|loan|credit|free)/i.test(local)) {
      evidence.push(`Payee name "${local}" contains urgency or reward words — unusual for a merchant VPA`);
      severity = severity === "high" ? "high" : "medium";
    }
  }

  if (amount !== null) {
    if (amount <= 0 || Number.isNaN(amount)) {
      evidence.push(`Amount field is invalid ("${String(d.amount)}")`);
      severity = severity === "high" ? "high" : "medium";
    } else if (amount >= 100000) {
      evidence.push(`Requested amount is ₹${amount.toLocaleString("en-IN")} — unusually high for a QR scan`);
      severity = severity === "high" ? "high" : "medium";
    }
  } else {
    evidence.push("No fixed amount in the payload — the sender may enter any amount");
  }

  const urlParam = String(d.responseUrl ?? "");
  if (urlParam && /^https?:\/\//i.test(urlParam) === false && urlParam.length > 0) {
    evidence.push(`Payment parameter "url" carries a non-standard value: ${urlParam.slice(0, 60)}`);
  }

  // Compound signal: a free-email payee AND reward/urgency wording anywhere in
  // the request (payee name or note) is the classic QR payment-scam pattern.
  const urgencyWords = /(winner|prize|refund|reward|bonus|gift|lottery|claim now|kyc|suspended|urgent|credit|cashback|loan)/i;
  const noteText = String(d.transactionNote ?? "");
  const nameText = String(d.payeeName ?? "");
  const payeeIsFreeMail = payee !== "" && FREE_MAIL_VPA_DOMAINS.includes((payee.split("@")[1] ?? "").toLowerCase());
  const urgencyInRequest = urgencyWords.test(`${payee} ${nameText} ${noteText}`);
  if (payeeIsFreeMail && urgencyInRequest) {
    evidence.push(
      `Compound signal: free-email payee (${payee}) with urgency wording in the request ("${(noteText || nameText).slice(0, 60)}")`,
    );
    severity = "critical";
  } else if (urgencyInRequest) {
    evidence.push(`Payment request uses reward/urgency wording ("${(noteText || nameText).slice(0, 60)}")`);
    // In this branch severity is never "critical" (the compound branch above
    // would have been taken), so only "high" must be preserved.
    if (severity !== "high") severity = "medium";
  }
  if (Object.keys(d.params ?? {}).some((k) => !["pa", "pn", "pm", "mc", "tr", "tn", "am", "amt", "cu", "url", "aid", "orgid", "mode", "purpose", "sign"].includes(k))) {
    const extra = Object.keys(d.params ?? {}).filter((k) => !["pa", "pn", "pm", "mc", "tr", "tn", "am", "amt", "cu", "url"].includes(k));
    evidence.push(`Non-standard UPI parameters present: ${extra.slice(0, 6).join(", ")}`);
  }

  if (evidence.length > 0) {
    return triggered(
      "upi_payment_risk", "Payment (UPI) indicators", "payments", severity,
      "Payment request detected — verify the recipient before paying.",
      evidence,
    );
  }
  return triggered(
    "upi_payment_risk", "Payment (UPI) indicators", "payments", "low",
    "Payment request detected — verify the recipient before paying. No high-risk signals found; this looks like an ordinary merchant QR, but confirm the payee name shown in your payment app.",
    [`Payee: ${payee || "unknown"}`, amount !== null ? `Amount: ₹${amount}` : "Amount: not fixed"],
  );
};

export const cryptoPayment: DetectorFn = (input) => {
  if (input.payload.type !== "crypto_payment") {
    return clean("crypto_payment", "Cryptocurrency payment indicators", "payments", "Not a cryptocurrency payload.");
  }
  const d = input.payload.details;
  const evidence: string[] = [];
  const amount = d.amount ?? d.value ?? d.amt;
  if (amount !== undefined && amount !== null) {
    evidence.push(`Payload requests a crypto amount of ${String(amount)}`);
  } else {
    evidence.push("No amount is specified — the sender chooses how much to send");
  }
  evidence.push(`Address: ${String(d.address ?? "").slice(0, 40)}…`);
  return triggered(
    "crypto_payment", "Cryptocurrency payment indicators", "payments", "medium",
    "Cryptocurrency payment detected — crypto transfers cannot be reversed. Verify the address character by character before sending anything.",
    evidence,
  );
};

export const redirectChain: DetectorFn = (input) => {
  const text = input.raw;
  const evidence: string[] = [];
  // Nested redirect URLs inside the payload
  const nested = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  if (nested.length >= 2) {
    evidence.push(`Payload embeds ${nested.length} chained URLs`);
    const hosts = new Set(nested.map((u) => { try { return new URL(u).hostname; } catch { return "?"; } }));
    if (hosts.size >= 2) evidence.push(`Chains across ${hosts.size} different hosts: ${[...hosts].slice(0, 4).join(", ")}`);
  }
  // open-redirect parameter patterns
  const m = text.match(/[?&](url|u|redir|redirect|next|dest|target|return|goto|r)=(https?%3a%2f%2f|https?:\/\/)([^&\s"']+)/i);
  if (m) {
    let target = m[3];
    try { target = decodeURIComponent(m[3]); } catch { /* keep */ }
    evidence.push(`Open-redirect parameter "${m[1]}" points at ${target.slice(0, 70)}`);
  }
  if (evidence.length > 0) {
    return triggered(
      "redirect_chain", "Excessive redirects", "redirects", "medium",
      "The link can bounce you through one or more unrelated sites before showing a final page.",
      evidence,
    );
  }
  return clean("redirect_chain", "Excessive redirects", "redirects", "No redirect chain patterns detected in the payload.");
};

export const paymentDetectors: DetectorFn[] = [upiPaymentRisk, cryptoPayment, redirectChain];
