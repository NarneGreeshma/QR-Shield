import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera, Upload, Keyboard, Radar, AlertTriangle, RotateCcw, X,
} from "lucide-react";
import type { AnalysisResult, ScanSource } from "@/lib/types";

import { api, ApiError } from "@/lib/api";
import { decodeImageFile } from "@/lib/qrImage";
import { useQrCamera } from "@/hooks/useQrCamera";
import { Panel, StateBlock, Badge } from "@/components/ui";
import { ResultScreen } from "@/components/ResultScreen";

type Tab = "camera" | "image" | "manual";

const PAY_PLACEHOLDER = "https://example.com  ·  upi://pay?pa=name@bank  ·  or any QR text";

/** Run the payload through the API and surface the result screen. */
export function useAnalyze() {
  const [result, setResult] = useState<(AnalysisResult & { id?: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (payload: string, source: ScanSource, persist = true) => {
    const trimmed = payload.trim();
    if (!trimmed) {
      setError("Nothing to analyze — the decoded payload was empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      console.log("[API] sending payload:", trimmed, "| source:", source);
      const r = persist ? await api.scan(trimmed, source) : await api.analyze(trimmed);
      console.log("[API] response:", r.classification, `${r.riskScore}/100`, "| id:", (r as { id?: number }).id ?? "n/a");
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unexpected error while analyzing.");
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, busy, error, run, reset, setError };
}

/** Full scan workspace: camera / image / manual tabs + result rendering. */
export function ScanWorkspace({ initialTab = "camera" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [manual, setManual] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageAttempts, setImageAttempts] = useState<string[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [lastSource, setLastSource] = useState<ScanSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { result, busy, error, run, reset, setError } = useAnalyze();

  const camera = useQrCamera(
    useCallback((text: string) => {
      setLastSource("camera");
      void run(text, "camera");
    }, [run]),
  );
  const cameraStart = camera.start;
  const cameraStop = camera.stop;

  // Leaving the camera tab must release the camera hardware (spec §1).
  const tabRef = useRef(tab);
  useEffect(() => {
    if (tabRef.current === "camera" && tab !== "camera") cameraStop();
    tabRef.current = tab;
  }, [tab, cameraStop]);

  // A result on screen means no preview is mounted — make sure the stream
  // cannot outlive it (covers image/manual results racing a live camera).
  useEffect(() => {
    if (result) cameraStop();
  }, [result, cameraStop]);

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setImageBusy(true);
    setImageError(null);
    setImageAttempts([]);
    try {
      const outcome = await decodeImageFile(file);
      if (outcome.ok && outcome.text) {
        setLastSource("image");
        await run(outcome.text, "image");
      } else {
        setImageError(outcome.error ?? "Could not decode this image.");
        setImageAttempts(outcome.attempts);
      }
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setImageBusy(false);
    }
  }, [run]);

  const tabs: { id: Tab; label: string; icon: typeof Camera }[] = [
    { id: "camera", label: "Live camera", icon: Camera },
    { id: "image", label: "Upload image", icon: Upload },
    { id: "manual", label: "Manual input", icon: Keyboard },
  ];

  if (result) {
    return (
      <div className="space-y-4">
        <ResultScreen result={result} onScanAnother={() => {
          reset();
          // Camera scans restart a fresh session (the old one released the
          // hardware on detection); other sources just return to the workspace.
          if (lastSource === "camera") {
            setTab("camera");
            setTimeout(() => cameraStart(), 50); // let the <video> remount first
          }
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="QR input method" className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === id
                ? "bg-accent text-base-950"
                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {error && (
        <StateBlock kind="error" title="Analysis failed" message={error}
          action={<button className="btn-ghost mt-2 text-xs" onClick={() => setError(null)}>Dismiss</button>} />
      )}
      {busy && <StateBlock kind="loading" title="Running security analysis…" message="Scoring happens on the server — never trust a client-side verdict." />}

      {!busy && tab === "camera" && (
        <Panel className="overflow-hidden">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
            <video
              ref={camera.videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
              aria-label="Camera preview for QR scanning"
            />
            {camera.status !== "running" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-950/90 p-6 text-center">
                <Radar className="h-8 w-8 text-accent" aria-hidden />
                {camera.status === "idle" && (
                  <>
                    <p className="text-sm text-slate-300">Point your camera at a QR code. Detection is automatic.</p>
                    <button className="btn-primary" onClick={() => void camera.start()}>
                      <Camera className="h-4 w-4" aria-hidden /> Start camera
                    </button>
                  </>
                )}
                {camera.status === "starting" && (
                  <>
                    <p className="text-sm text-slate-300" role="status">{camera.message}</p>
                    <button className="btn-ghost text-xs" onClick={() => camera.stop()}>
                      Cancel
                    </button>
                  </>
                )}
                {(camera.status === "denied" ||
                  camera.status === "unavailable" ||
                  camera.status === "in_use" ||
                  camera.status === "unsupported" ||
                  camera.status === "error") && (
                  <>
                    <p role="alert" className="max-w-md text-sm text-rose-300">{camera.message}</p>
                    <div className="flex gap-2">
                      {camera.status !== "unsupported" && (
                        <button className="btn-ghost text-xs" onClick={() => void camera.start()}>Try again</button>
                      )}
                      <button className="btn-ghost text-xs" onClick={() => setTab("image")}>Use image upload</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Badge tone="safe">Privacy first</Badge>
              Frames are processed on-device and never stored.
            </span>
            {camera.status === "running" && (
              <button className="btn-ghost text-xs" onClick={() => camera.stop()}>Stop camera</button>
            )}
          </div>
        </Panel>
      )}

      {!busy && tab === "image" && (
        <Panel>
          <label
            htmlFor="qr-file"
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/15 bg-base-900/60 px-6 py-12 text-center transition-colors hover:border-accent/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <Upload className="h-7 w-7 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-slate-200">
              {imageBusy ? "Decoding image…" : "Drop a QR image here, or click to browse"}
            </span>
            <span className="text-xs text-slate-500">PNG, JPG/JPEG or WebP · screenshots and photos both work</span>
            <input
              id="qr-file"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              disabled={imageBusy}
            />
          </label>
          {imageBusy && <StateBlock kind="loading" title="Decoding…" message="Trying original, grayscale, contrast and inverted passes." />}
          {imageError && (
            <div className="mt-4">
              <StateBlock
                kind="error"
                title="Could not decode a QR code"
                message={imageError}
                action={
                  imageAttempts.length > 0 ? (
                    <details className="mt-2 text-left text-xs text-slate-500">
                      <summary className="cursor-pointer">Decoding attempts</summary>
                      <ul className="mt-1 list-inside list-disc">
                        {imageAttempts.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </details>
                  ) : undefined
                }
              />
            </div>
          )}
        </Panel>
      )}

      {!busy && tab === "manual" && (
        <Panel>
          <label htmlFor="manual-payload" className="label-caps mb-2 block">
            Paste a URL, UPI URI, or any QR payload
          </label>
          <textarea
            id="manual-payload"
            className="input min-h-[110px] resize-y font-mono text-[13px]"
            placeholder={PAY_PLACEHOLDER}
            value={manual}
            onChange={(e) => setManual(e.target.value)}              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  setLastSource("manual");
                  void run(manual, "manual");
                }
              }}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">Ctrl/Cmd + Enter to analyze</span>
            <button
              className="btn-primary"
              onClick={() => {
                setLastSource("manual");
                void run(manual, "manual");
              }}
              disabled={!manual.trim()}
            >
              <ShieldCheckIcon /> Analyze payload
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function ShieldCheckIcon() {
  return <Radar className="h-4 w-4" aria-hidden />;
}
