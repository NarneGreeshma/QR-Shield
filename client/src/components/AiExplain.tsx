import { useState } from "react";
import { Sparkles, Lock } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import { Panel } from "@/components/ui";

/**
 * OPTIONAL AI explanation.
 *
 * The deterministic score is computed server-side and never changes here —
 * the AI only receives the structured findings and rephrases them.
 * When no provider is configured the panel explains that plainly.
 */
export function AiExplain({ result }: { result: AnalysisResult }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: result.payload.destination,
          classification: result.classification,
          riskScore: result.riskScore,
          findings: result.triggered.map((t) => ({
            detector: t.label,
            severity: t.severity,
            explanation: t.explanation,
            evidence: t.evidence,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Request failed");
      setText(body.explanation);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />
          <span className="label-caps">AI explanation (optional)</span>
        </div>
        {!enabled ? (
          <button type="button" className="btn-ghost text-xs" onClick={() => setEnabled(true)}>
            Explain this threat
          </button>
        ) : (
          <button type="button" className="btn-ghost text-xs" onClick={run} disabled={loading}>
            {loading ? "Generating…" : "Generate explanation"}
          </button>
        )}
      </div>

      {enabled && (
        <div className="mt-3 space-y-3">
          <p className="flex items-center gap-2 text-xs text-slate-400">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Only the structured findings above are sent. The AI cannot change your risk score.
          </p>
          {text && <p className="rounded-lg border border-white/5 bg-base-900/60 p-4 text-sm leading-relaxed text-slate-200">{text}</p>}
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {!text && !error && !loading && (
            <p className="text-sm text-slate-500">
              Core detection runs without AI. If no AI provider is configured on this server, the panel will explain that — nothing is faked.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
