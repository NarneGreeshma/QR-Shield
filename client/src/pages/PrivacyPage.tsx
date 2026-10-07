import { useEffect, useState } from "react";
import { Lock, Camera, Database, KeyRound, Trash2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Panel } from "@/components/ui";

const PRINCIPLES = [
  {
    icon: Camera,
    title: "Camera frames stay on your device",
    body: "Live scanning decodes QR codes in the browser with jsQR. Video frames are never uploaded, stored, or logged.",
  },
  {
    icon: Database,
    title: "Only structured scan records are stored",
    body: "Your history stores the decoded payload text, risk verdict and detector evidence in local SQLite — no images, no location, no account.",
  },
  {
    icon: KeyRound,
    title: "No API keys in frontend code",
    body: "The browser only ever talks to your local API. Any AI provider key lives in a server environment variable and is never shipped to the client.",
  },
  {
    icon: Lock,
    title: "No paid services, no tracking",
    body: "No analytics, no third-party scripts, no telemetry. Everything runs locally on your machine.",
  },
  {
    icon: ShieldCheck,
    title: "Scores are computed server-side",
    body: "The client cannot influence risk scoring — verdicts come from the deterministic engine, not from anything the page sends.",
  },
];

export function PrivacyPage() {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [cleared, setCleared] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health().then((h) => setAiEnabled(h.ai)).catch(() => setAiEnabled(false));
  }, []);

  const clear = async () => {
    try {
      const res = await api.clearHistory();
      setCleared(res.deleted);
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Lock className="h-5 w-5 text-accent" aria-hidden /> Privacy First
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            QR Shield is local-first by design. Here is exactly what happens to your data.
          </p>
        </div>
        <Badge tone="safe" className="shrink-0">Privacy First</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PRINCIPLES.map(({ icon: Icon, title, body }) => (
          <Panel key={title} className="panel-hover flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
              <Icon className="h-5 w-5 text-accent" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              <p className="mt-1 text-sm text-slate-400">{body}</p>
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <h3 className="text-base font-semibold text-white">Data controls</h3>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-base-900/60 p-4">
            <div>
              <p className="text-sm font-medium text-slate-200">Scan history</p>
              <p className="text-xs text-slate-500">Stored locally in SQLite. Deleting removes it permanently.</p>
            </div>
            {confirming ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-rose-300">Delete everything?</span>
                <button className="btn-danger text-xs" onClick={() => void clear()}>Yes, delete</button>
                <button className="btn-ghost text-xs" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-danger text-xs" onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear my scan history
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-base-900/60 p-4">
            <div>
              <p className="text-sm font-medium text-slate-200">AI explanations</p>
              <p className="text-xs text-slate-500">
                Optional. Only structured findings are sent to the provider — and only when you click.
              </p>
            </div>
            <Badge tone={aiEnabled ? "info" : "neutral"}>{aiEnabled ? "Configured" : "Not configured"}</Badge>
          </div>
        </div>
        {cleared !== null && (
          <p role="status" className="mt-3 text-sm text-emerald-400">
            Deleted {cleared} scan{cleared === 1 ? "" : "s"} from local storage.
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      </Panel>
    </div>
  );
}
