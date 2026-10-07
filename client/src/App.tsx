import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import {
  Radar, LayoutDashboard, History, ShieldCheck, ScanEye, FlaskConical, Lock,
} from "lucide-react";
import { ScanPage } from "@/pages/ScanPage";

// Route-level code splitting keeps the initial bundle small.
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const HistoryPage = lazy(() => import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const ScanDetailPage = lazy(() => import("@/pages/ScanDetailPage").then((m) => ({ default: m.ScanDetailPage })));
const SecurityCenterPage = lazy(() => import("@/pages/SecurityCenterPage").then((m) => ({ default: m.SecurityCenterPage })));
const DemoPage = lazy(() => import("@/pages/DemoPage").then((m) => ({ default: m.DemoPage })));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })));

const NAV = [
  { to: "/", label: "Scan", icon: Radar, end: true },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/history", label: "History", icon: History },
  { to: "/security-center", label: "Security Center", icon: ShieldCheck },
  { to: "/demo", label: "Demo", icon: FlaskConical },
  { to: "/privacy", label: "Privacy", icon: Lock },
];

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 shadow-glow">
            <ScanEye className="h-5 w-5 text-accent" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              QR SHIELD
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent/80">
              Pause before you tap
            </p>
          </div>
        </div>
        <span className="hidden rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-400 sm:inline">
          Local-first · no paid APIs · server-side scoring
        </span>
      </header>

      <nav aria-label="Primary" className="mb-6 flex flex-wrap gap-1.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent/15 text-accent ring-1 ring-accent/40"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`
            }
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1">
        <Suspense
          fallback={
            <div role="status" className="panel flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-400">
              <span className="animate-pulse-soft text-accent" aria-hidden>◌</span> Loading view…
            </div>
          }
        >
          <Routes>
          <Route path="/" element={<ScanPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/scan/:id" element={<ScanDetailPage />} />
          <Route path="/security-center" element={<SecurityCenterPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<ScanPage />} />
        </Routes>
        </Suspense>
      </main>

      <footer className="mt-10 border-t border-white/5 pt-4 text-center text-xs text-slate-500">
        QR SHIELD · deterministic risk scoring · educational tool — always verify independently
      </footer>
    </div>
  );
}
