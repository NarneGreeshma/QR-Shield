import { useEffect, useRef, useState } from "react";
import type { Classification } from "@/lib/types";

const COLORS: Record<Classification, string> = {
  SAFE: "#10b981",
  SUSPICIOUS: "#f59e0b",
  DANGEROUS: "#f43f5e",
};

/**
 * Deterministic risk meter: SVG arc, animates to the score, respects
 * prefers-reduced-motion, and is labelled for screen readers.
 */
export function RiskMeter({ score, classification }: { score: number; classification: Classification }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(score);
      return;
    }
    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(score * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [score]);

  const color = COLORS[classification];
  const radius = 84;
  const circumference = Math.PI * radius; // semicircle
  const progress = (display / 100) * circumference;

  return (
    <div className="flex flex-col items-center" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}
      aria-label={`Risk score ${score} out of 100, ${classification}`}>
      <svg width="230" height="135" viewBox="0 0 230 135" aria-hidden="true">
        <path
          d={`M 31 120 A ${radius} ${radius} 0 0 1 199 120`}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d={`M 31 120 A ${radius} ${radius} 0 0 1 199 120`}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          style={{ filter: `drop-shadow(0 0 8px ${color}66)`, transition: "stroke 200ms" }}
        />
        <text x="115" y="105" textAnchor="middle" className="fill-white font-mono" style={{ fontSize: 44, fontWeight: 700 }}>
          {display}
        </text>
        <text x="115" y="126" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 13 }}>
          / 100
        </text>
      </svg>
      <span
        className="-mt-1 rounded-md border px-3 py-1 text-sm font-bold tracking-widest"
        style={{ color, borderColor: `${color}55`, background: `${color}15` }}
      >
        {classification}
      </span>
    </div>
  );
}
