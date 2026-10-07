import { useState } from "react";
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, Clock, ExternalLink, Info,
  ChevronDown, Radar,
} from "lucide-react";
import type { AnalysisResult, DetectorResult } from "@/lib/types";
import { Badge, Panel, classificationTone, severityTone } from "@/components/ui";
import { RiskMeter } from "@/components/RiskMeter";
import { AiExplain } from "@/components/AiExplain";

const PAYLOAD_LABELS: Record<string, string> = {
  https_url: "HTTPS URL", http_url: "HTTP URL", upi_payment: "UPI payment",
  crypto_payment: "Crypto payment", phone: "Phone number", email: "Email",
  sms: "SMS message", wifi: "WiFi credentials", contact: "Contact card",
  text: "Plain text", unknown_uri: "Custom URI", empty: "Empty payload",
};

function DetectorCard({ d, defaultOpen }: { d: DetectorResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <li className="rounded-lg border border-white/5 bg-base-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
      >
        <Badge tone={d.triggered ? severityTone(d.severity) : "neutral"}>
          {d.triggered ? d.severity.toUpperCase() : "CLEAN"}
        </Badge>
        <span className="flex-1 text-sm font-medium text-slate-200">{d.label}</span>
        {d.triggered && <span className="font-mono text-xs font-semibold text-amber-300">+{d.score}</span>}
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-white/5 px-4 py-3 text-sm">
          <p className="text-slate-300">{d.explanation}</p>
          {d.evidence.length > 0 && (
            <ul className="mt-2 space-y-1">
              {d.evidence.map((e, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-400">
                  <span className="text-accent" aria-hidden>›</span>
                  <span className="mono">{e}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Security result screen: verdict, score, threats, evidence, guidance.
 * Dangerous results never link to the destination.
 */
export function ResultScreen({
  result,
  onScanAnother,
  demo = false,
}: {
  result: AnalysisResult;
  onScanAnother?: () => void;
  demo?: boolean;
}) {
  const c = result.classification;
  const Icon = c === "SAFE" ? ShieldCheck : c === "SUSPICIOUS" ? ShieldQuestion : ShieldAlert;
  const color = c === "SAFE" ? "text-emerald-400" : c === "SUSPICIOUS" ? "text-amber-400" : "text-rose-400";
  const canOpenLink = c === "SAFE" && result.payload.type !== "upi_payment" && result.payload.type !== "crypto_payment";

  return (
    <div className="animate-fade-in space-y-5">
      {demo && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200">
          DEMO TEST CASE — prepared example, not a real scan. Not saved to your history.
        </div>
      )}

      <Panel className="flex flex-col items-center gap-4 py-8">
        <Icon className={`h-10 w-10 ${color}`} aria-hidden />
        <RiskMeter score={result.riskScore} classification={c} />
        <p className="max-w-xl px-4 text-center text-sm leading-relaxed text-slate-300">
          {result.recommendation}
        </p>
        {onScanAnother && (
          <button type="button" className="btn-primary" onClick={onScanAnother}>
            <Radar className="h-4 w-4" aria-hidden /> Scan another
          </button>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <span className="label-caps">Payload</span>
            <Badge tone="info">{PAYLOAD_LABELS[result.payload.type] ?? result.payload.type}</Badge>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Destination</dt>
              <dd className="mono mt-0.5 text-slate-100">{result.payload.destination}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Normalized value</dt>
              <dd className="mono mt-0.5 text-slate-400">{result.payload.normalized.slice(0, 300)}</dd>
            </div>
            <div className="flex items-center gap-1.5 pt-1 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Scanned {new Date(result.analyzedAt).toLocaleString()}
            </div>
          </dl>
          <div className="mt-4 flex gap-2">
            {canOpenLink ? (
              <a
                className="btn-ghost text-xs"
                href={result.payload.normalized}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open destination
              </a>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Opening this destination is disabled — {c === "SAFE" ? "payment payloads require your payment app" : "risk is too high"}.
              </p>
            )}
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <span className="label-caps">Score composition</span>
            <span className="font-mono text-sm font-bold text-slate-200">{result.riskScore}/100</span>
          </div>
          {result.reasons.length === 0 ? (
            <p className="text-sm text-slate-400">No detectors were triggered for this payload.</p>
          ) : (
            <ul className="space-y-1.5">
              {result.breakdown.map((b) => (
                <li key={b.detector} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">
                    <span className="mr-2 font-mono font-semibold text-amber-300">+{b.score}</span>
                    {b.label}
                  </span>
                  <Badge tone={severityTone(b.severity)}>{b.severity}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className={`h-4 w-4 ${color}`} aria-hidden />
          <span className="label-caps">Why this was flagged</span>
          <Badge tone={classificationTone(c)}>{result.triggered.length} signal{result.triggered.length === 1 ? "" : "s"}</Badge>
        </div>
        {result.triggered.length === 0 ? (
          <p className="text-sm text-slate-400">
            No risk signals were detected. This does not guarantee safety — always verify unexpected messages independently.
          </p>
        ) : (
          <ul className="space-y-3">
            {result.triggered.map((d) => (
              <li key={d.detector} className="rounded-lg border border-white/5 bg-base-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={severityTone(d.severity)}>{d.severity.toUpperCase()}</Badge>
                  <span className="text-sm font-semibold text-slate-100">{d.label}</span>
                  <span className="font-mono text-xs text-amber-300">+{d.score}</span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{d.explanation}</p>
                {d.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {d.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-400">
                        <span className="text-accent" aria-hidden>›</span>
                        <span className="mono">{e}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-cyan-100/90">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>What you should do:</strong> {result.recommendation}
          </span>
        </p>
      </Panel>

      <AiExplain result={result} />

      <Panel>
        <span className="label-caps">Full detector matrix</span>
        <p className="mb-3 mt-1 text-sm text-slate-400">
          Every detector ran against this payload. Clean detectors are shown for transparency.
        </p>
        <ul className="space-y-1.5">
          {result.detectors.map((d) => (
            <DetectorCard key={d.detector} d={d} defaultOpen={d.triggered} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
