import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowDown, Radar, Scale, Gavel, ChevronDown,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AnalysisResult, DetectorResult } from "@/lib/types";
import { Badge, Panel, StateBlock, severityTone } from "@/components/ui";
import { RiskMeter } from "@/components/RiskMeter";

type Detail = AnalysisResult & { id: number; createdAt: string; source: string; payloadRaw: string };

function Stage({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <div className="mb-3 flex items-center gap-2 text-accent">
        {icon}
        <span className="label-caps !text-accent">{title}</span>
      </div>
      {children}
      <ArrowDown className="mx-auto mt-3 h-4 w-4 text-slate-600" aria-hidden />
    </Panel>
  );
}

function DetectorRow({ d }: { d: DetectorResult }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-white/5 bg-base-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03]"
      >
        <span className="w-20 shrink-0"><Badge tone={d.triggered ? severityTone(d.severity) : "neutral"}>{d.triggered ? d.severity.toUpperCase() : "CLEAN"}</Badge></span>
        <span className="flex-1 text-sm font-medium text-slate-200">{d.label}</span>
        <span className="font-mono text-xs text-slate-500">{d.category}</span>
        <span className={`w-12 text-right font-mono text-xs font-semibold ${d.triggered ? "text-amber-300" : "text-slate-600"}`}>
          {d.triggered ? `+${d.score}` : "0"}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 py-3 text-sm">
          <p className="text-slate-300">{d.explanation}</p>
          {d.evidence.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {d.evidence.map((e, i) => (
                <li key={i} className="mono flex gap-2 text-slate-400"><span className="text-accent">›</span>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No evidence — detector did not trigger.</p>
          )}
        </div>
      )}
    </li>
  );
}

/** Security Analyst mode: payload → normalization → detection → scoring → verdict. */
export function ScanDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id || Number.isNaN(Number(id))) {
      setError("Invalid scan id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .scanDetail(Number(id))
      .then((d) => setDetail(d as unknown as Detail))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load scan"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  if (loading) return <StateBlock kind="loading" title="Loading analyst report…" />;
  if (error) return <StateBlock kind="error" title="Scan not available" message={error} action={<Link to="/history" className="btn-ghost mt-2 text-xs">Back to history</Link>} />;
  if (!detail) return null;

  const triggered = detail.detectors.filter((d) => d.triggered);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Security analyst report</h2>
          <p className="mt-1 text-sm text-slate-400">Scan #{detail.id} · {new Date(detail.createdAt).toLocaleString()} · source: {detail.source}</p>
        </div>
        <Link to="/history" className="btn-ghost text-xs">Back to history</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <Stage icon={<Radar className="h-4 w-4" aria-hidden />} title="1 · Payload">
            <p className="mono text-slate-100">{detail.payloadRaw.slice(0, 600)}</p>
            <p className="mt-2 text-xs text-slate-500">Type: {detail.payload.type}</p>
          </Stage>

          <Stage icon={<Radar className="h-4 w-4" aria-hidden />} title="2 · Normalization">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Destination</dt><dd className="mono text-slate-200">{detail.payload.destination}</dd></div>
              <div><dt className="text-slate-500">Normalized</dt><dd className="mono text-slate-400">{detail.payload.normalized.slice(0, 240)}</dd></div>
            </dl>
          </Stage>

          <Stage icon={<Radar className="h-4 w-4" aria-hidden />} title={`3 · Detection results (${triggered.length}/${detail.detectors.length} triggered)`}>
            <ul className="space-y-1.5">
              {detail.detectors.map((d) => <DetectorRow key={d.detector} d={d} />)}
            </ul>
          </Stage>

          <Stage icon={<Scale className="h-4 w-4" aria-hidden />} title="4 · Risk calculation">
            {detail.breakdown.length === 0 ? (
              <p className="text-sm text-slate-400">No detector contributions — score is 0.</p>
            ) : (
              <div className="space-y-3">
                <ul className="space-y-1.5">
                  {detail.breakdown.map((b) => (
                    <li key={b.detector} className="flex items-center gap-3 text-sm">
                      <span className="w-14 shrink-0 font-mono font-semibold text-amber-300">+{b.score}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan"
                          style={{ width: `${(b.score / 40) * 100}%` }}
                        />
                      </div>
                      <span className="w-56 truncate text-slate-300">{b.label}</span>
                      <Badge tone={severityTone(b.severity)}>{b.severity}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="rounded-lg border border-white/10 bg-base-900/60 p-3 font-mono text-sm text-slate-300">
                  min(100, Σ contributions{detail.breakdown.some((b) => b.score >= 35) ? " + amplification bonus" : ""}) = {detail.riskScore}
                </p>
              </div>
            )}
          </Stage>

          <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
            <div className="flex items-center gap-2 text-accent">
              <Gavel className="h-4 w-4" aria-hidden />
              <span className="label-caps !text-accent">5 · Final verdict</span>
            </div>
            <p className="mt-2 font-mono text-3xl font-bold text-white">{detail.riskScore} / 100</p>
            <p className="mt-1 text-lg font-bold tracking-widest"
              style={{ color: detail.classification === "SAFE" ? "#10b981" : detail.classification === "SUSPICIOUS" ? "#f59e0b" : "#f43f5e" }}>
              {detail.classification}
            </p>
            <p className="mt-2 text-sm text-slate-300">{detail.recommendation}</p>
          </div>
        </div>

        <div className="space-y-4">
          <Panel className="flex justify-center py-6">
            <RiskMeter score={detail.riskScore} classification={detail.classification} />
          </Panel>
          <Panel>
            <span className="label-caps">Detector summary</span>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">Total detectors</dt><dd className="font-mono text-slate-200">{detail.detectors.length}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Triggered</dt><dd className="font-mono text-amber-300">{triggered.length}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Categories</dt><dd className="font-mono text-slate-200">{new Set(detail.detectors.map((d) => d.category)).size}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
