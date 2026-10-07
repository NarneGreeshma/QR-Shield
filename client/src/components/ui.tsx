import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { Classification, Severity } from "@/lib/types";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("panel p-5", className)}>{children}</div>;
}

export function SectionTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
      {icon}
      {children}
    </h2>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "safe" | "warn" | "danger" | "info";
  className?: string;
}) {
  const tones = {
    neutral: "border-white/10 bg-white/5 text-slate-300",
    safe: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    info: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export const classificationTone = (c: Classification): "safe" | "warn" | "danger" =>
  c === "SAFE" ? "safe" : c === "SUSPICIOUS" ? "warn" : "danger";

export const severityTone = (s: Severity): "neutral" | "safe" | "warn" | "danger" | "info" => {
  switch (s) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warn";
    case "low":
      return "info";
    default:
      return "neutral";
  }
};

/** Consistent loading / empty / error states — no infinite "Loading…". */
export function StateBlock({
  kind,
  title,
  message,
  action,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const icon =
    kind === "error" ? "⚠" : kind === "empty" ? "◇" : "◌";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="panel flex flex-col items-center justify-center gap-2 px-6 py-12 text-center"
    >
      <span
        className={clsx(
          "text-2xl",
          kind === "error" ? "text-rose-400" : kind === "loading" ? "animate-pulse-soft text-accent" : "text-slate-500",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {message && <p className="max-w-md text-sm text-slate-400">{message}</p>}
      {action}
    </div>
  );
}
