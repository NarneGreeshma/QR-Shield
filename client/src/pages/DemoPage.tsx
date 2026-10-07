import { useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { DEMO_CASES, type DemoCase } from "@/lib/demoCases";
import { api, ApiError } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";
import { Badge, Panel, StateBlock, classificationTone } from "@/components/ui";
import { ResultScreen } from "@/components/ResultScreen";

interface DemoRun {
  testCase: DemoCase;
  result: AnalysisResult;
}

export function DemoPage() {
  const [runs, setRuns] = useState<DemoRun[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCase = async (testCase: DemoCase) => {
    setBusyId(testCase.id);
    setError(null);
    try {
      // /api/analyze does NOT persist — demo data never mixes with real history.
      const result = await api.analyze(testCase.payload);
      setRuns((prev) => [...prev.filter((r) => r.testCase.id !== testCase.id), { testCase, result }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo run failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Demo mode</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Prepared test cases for judges. They run through the <strong>real engine</strong> via{" "}
          <code className="mono text-accent">POST /api/analyze</code>, which never writes to your history —
          demo results stay separate from real scans.
        </p>
      </div>

      {error && <StateBlock kind="error" title="Demo failed" message={error} />}

      <div className="grid gap-4 md:grid-cols-3">
        {DEMO_CASES.map((c) => {
          const run = runs.find((r) => r.testCase.id === c.id);
          return (
            <Panel key={c.id} className="flex flex-col">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden />
                <Badge tone="info">DEMO TEST CASE</Badge>
              </div>
              <h3 className="mt-3 text-base font-semibold text-white">{c.title}</h3>
              <p className="mt-1 flex-1 text-sm text-slate-400">{c.blurb}</p>
              <p className="mono mt-3 rounded-md border border-white/5 bg-base-900/70 p-2 text-xs text-slate-500">
                {c.payload.slice(0, 90)}{c.payload.length > 90 ? "…" : ""}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">Expected: <strong className="text-slate-300">{c.expect}</strong></span>
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void runCase(c)} disabled={busyId === c.id}>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {busyId === c.id ? "Running…" : run ? "Re-run" : "Run case"}
                </button>
              </div>
              {run && (
                <p className="mt-2 text-xs">
                  Actual:{" "}
                  <Badge tone={classificationTone(run.result.classification)}>
                    {run.result.classification} · {run.result.riskScore}/100
                  </Badge>{" "}
                  {run.result.classification === run.testCase.expect ? (
                    <span className="text-emerald-400">matches expectation</span>
                  ) : (
                    <span className="text-amber-400">differs from expectation</span>
                  )}
                </p>
              )}
            </Panel>
          );
        })}
      </div>

      {runs.map(({ testCase, result }) => (
        <div key={testCase.id}>
          <div className="mb-3 flex items-center gap-2">
            <Badge tone="info">DEMO TEST CASE</Badge>
            <span className="text-sm font-semibold text-white">{testCase.title}</span>
          </div>
          <ResultScreen result={result} demo />
        </div>
      ))}

      {runs.length === 0 && (
        <StateBlock
          kind="empty"
          title="No demo cases run yet"
          message="Run a prepared case above to walk judges through the engine's reasoning."
        />
      )}
    </div>
  );
}
