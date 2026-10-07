/**
 * OPTIONAL AI explanation endpoint.
 *
 * The deterministic score is never produced or modified here: the AI only
 * receives structured findings and rephrases them for a normal user.
 * Configuration: QRSHIELD_AI_API_KEY (+ optional QRSHIELD_AI_BASE_URL,
 * QRSHIELD_AI_MODEL). Keys live only on the server — never in the frontend.
 */

import { z } from "zod";

const explainSchema = z.object({
  payload: z.string().max(2000),
  classification: z.enum(["SAFE", "SUSPICIOUS", "DANGEROUS"]),
  riskScore: z.number().int().min(0).max(100),
  findings: z
    .array(
      z.object({
        detector: z.string().max(120),
        severity: z.string().max(20),
        explanation: z.string().max(600),
        evidence: z.array(z.string().max(400)).max(8),
      }),
    )
    .max(30),
});

export function hasAiConfig(): boolean {
  return Boolean(process.env.QRSHIELD_AI_API_KEY);
}

export async function explainFindings(body: unknown): Promise<{ explanation: string } | { error: string; status: number }> {
  const parsed = explainSchema.safeParse(body);
  if (!parsed.success) {
    return { error: "Invalid request", status: 400 };
  }
  if (!hasAiConfig()) {
    return {
      error:
        "No AI provider is configured. QR Shield works fully without AI — set QRSHIELD_AI_API_KEY on the server to enable optional explanations.",
      status: 503,
    };
  }

  const { payload, classification, riskScore, findings } = parsed.data;
  const system =
    "You are the explanation assistant inside QR SHIELD, a QR security product. " +
    "Explain the given security findings to a non-technical user in at most 120 words, in plain language, " +
    "with three short parts: what happened, why it is risky, and what the user should do. " +
    "You cannot change the risk score; never contradict the given classification. Do not invent evidence.";

  const user = JSON.stringify({ destination: payload, classification, riskScore, findings });

  const baseUrl = (process.env.QRSHIELD_AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.QRSHIELD_AI_MODEL ?? "gpt-4o-mini";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.QRSHIELD_AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { error: `AI provider returned ${res.status}`, status: 502 };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: "AI provider returned an empty response", status: 502 };
    return { explanation: text };
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
    return { error: timedOut ? "AI provider timed out" : "AI provider unreachable", status: 502 };
  }
}
