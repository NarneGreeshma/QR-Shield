import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, ShieldCheck, ShieldAlert, ShieldQuestion, Radar } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { StatsResponse, ScanListItem } from "@/lib/types";
import { Badge, Panel, StateBlock, classificationTone } from "@/components/ui";

const PIE_COLORS = { safe: "#10b981", suspicious: "#f59e0b", dangerous: "#f43f5e" };

export function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recent, setRecent] = useState<ScanListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.stats(), api.history({ limit: 6 })])
      .then(([s, h]) => {
        setStats(s);
        setRecent(h.items);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <StateBlock kind="loading" title="Loading dashboard…" message="Reading real scan data from SQLite." />;
  if (error) return <StateBlock kind="error" title="Dashboard unavailable" message={error} action={<button className="btn-ghost mt-2 text-xs" onClick={load}>Retry</button>} />;
  if (!stats) return null;

  if (stats.total === 0) {
    return (
      <StateBlock
        kind="empty"
        title="No scans yet"
        message="Your dashboard is built exclusively from real stored scans. Scan a QR code to populate it."
        action={<Link className="btn-primary mt-2" to="/">Start scanning</Link>}
      />
    );
  }

  const distribution = [
    { name: "Safe", value: stats.safe, color: PIE_COLORS.safe },
    { name: "Suspicious", value: stats.suspicious, color: PIE_COLORS.suspicious },
    { name: "Dangerous", value: stats.dangerous, color: PIE_COLORS.dangerous },
  ];

  const cards = [
    { label: "Total scans", value: stats.total, icon: Activity, tone: "text-slate-100" },
    { label: "Safe", value: stats.safe, icon: ShieldCheck, tone: "text-emerald-400" },
    { label: "Suspicious", value: stats.suspicious, icon: ShieldQuestion, tone: "text-amber-400" },
    { label: "Dangerous", value: stats.dangerous, icon: ShieldAlert, tone: "text-rose-400" },
    { label: "Threats detected", value: stats.threatsDetected, icon: Radar, tone: "text-cyan-300" },
    { label: "Avg risk score", value: stats.avgScore, icon: Activity, tone: "text-slate-100" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Security dashboard</h2>
        <p className="mt-1 text-sm text-slate-400">Aggregated from your stored scans — no synthetic numbers.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <Panel key={label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="label-caps">{label}</span>
              <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
            </div>
            <p className={`mt-2 text-3xl font-bold ${tone}`}>{value}</p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <span className="label-caps">Risk distribution</span>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {distribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#0f131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <span className="label-caps">Threat trends (last 30 days)</span>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.byDay}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} width={30} />
                <Tooltip contentStyle={{ background: "#0f131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="total" stroke="#22d3ee" strokeWidth={2} name="Scans" dot={false} />
                <Line type="monotone" dataKey="dangerous" stroke="#f43f5e" strokeWidth={2} name="Dangerous" dot={false} />
                <Line type="monotone" dataKey="suspicious" stroke="#f59e0b" strokeWidth={2} name="Suspicious" dot={false} />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <span className="label-caps">Most common threat types</span>
          <div className="mt-3 h-64">
            {stats.topThreats.length === 0 ? (
              <p className="pt-16 text-center text-sm text-slate-500">No threats detected yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topThreats} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={150} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0f131a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="label-caps">Recent scans</span>
            <Link to="/history" className="text-xs font-medium text-accent hover:underline">View all</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {recent.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/scan/${s.id}`}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-base-900/60 px-3 py-2.5 transition-colors hover:border-white/15"
                >
                  <span className="w-10 shrink-0 text-center font-mono text-sm font-bold"
                    style={{ color: s.classification === "SAFE" ? PIE_COLORS.safe : s.classification === "SUSPICIOUS" ? PIE_COLORS.suspicious : PIE_COLORS.dangerous }}>
                    {s.riskScore}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-200">{s.destination}</span>
                    <span className="block text-xs text-slate-500">{new Date(s.createdAt).toLocaleString()}</span>
                  </span>
                  <Badge tone={classificationTone(s.classification)}>{s.classification}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
