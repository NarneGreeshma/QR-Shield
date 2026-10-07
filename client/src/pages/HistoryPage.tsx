import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Trash2, SortAsc, SortDesc } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Classification, ScanListItem } from "@/lib/types";
import { Badge, Panel, StateBlock, classificationTone } from "@/components/ui";

const CLASSIFICATIONS: (Classification | "ALL")[] = ["ALL", "SAFE", "SUSPICIOUS", "DANGEROUS"];
const SORTS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "risk_desc", label: "Risk ↓" },
  { id: "risk_asc", label: "Risk ↑" },
];

export function HistoryPage() {
  const [q, setQ] = useState("");
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number]>("ALL");
  const [sort, setSort] = useState("newest");
  const [items, setItems] = useState<ScanListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .history({ q: q || undefined, classification, sort, limit: 50 })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load history"))
      .finally(() => setLoading(false));
  }, [q, classification, sort]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (id: number) => {
    try {
      await api.deleteScan(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setTotal((t) => t - 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  };

  const clearAll = async () => {
    try {
      await api.clearHistory();
      setItems([]);
      setTotal(0);
      setConfirmClear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Clear failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Scan history</h2>
          <p className="mt-1 text-sm text-slate-400">{total} stored scan{total === 1 ? "" : "s"} in local SQLite.</p>
        </div>
        {total > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-rose-300">Delete all scans?</span>
              <button className="btn-danger text-xs" onClick={() => void clearAll()}>Yes, clear</button>
              <button className="btn-ghost text-xs" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-danger text-xs" onClick={() => setConfirmClear(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear history
            </button>
          )
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            className="input pl-9"
            placeholder="Search destination or payload…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search scans"
          />
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Filter by classification">
          {CLASSIFICATIONS.map((c) => (
            <button
              key={c}
              onClick={() => setClassification(c)}
              aria-pressed={classification === c}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                classification === c ? "bg-accent text-base-950" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Sort order">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              aria-pressed={sort === s.id}
              className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                sort === s.id ? "bg-accent text-base-950" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {s.id.includes("desc") ? <SortDesc className="h-3 w-3" aria-hidden /> : <SortAsc className="h-3 w-3" aria-hidden />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <StateBlock kind="loading" title="Loading history…" />}
      {!loading && error && <StateBlock kind="error" title="Could not load history" message={error} action={<button className="btn-ghost mt-2 text-xs" onClick={load}>Retry</button>} />}
      {!loading && !error && items.length === 0 && (
        <StateBlock
          kind="empty"
          title={q || classification !== "ALL" ? "No scans match your filters" : "No scans stored yet"}
          message={q || classification !== "ALL" ? "Try a different search term or classification." : "Scan a QR code and it will appear here."}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Destination</th>
                <th className="px-4 py-3 font-semibold">Risk</th>
                <th className="px-4 py-3 font-semibold">Verdict</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{s.payloadType}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-slate-200" title={s.destination}>{s.destination}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-200">{s.riskScore}</td>
                  <td className="px-4 py-3"><Badge tone={classificationTone(s.classification)}>{s.classification}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Link to={`/scan/${s.id}`} className="btn-ghost px-2.5 py-1.5 text-xs">Analyst view</Link>
                      <button className="btn-ghost px-2.5 py-1.5 text-xs text-rose-300" onClick={() => void remove(s.id)} aria-label={`Delete scan of ${s.destination}`}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
