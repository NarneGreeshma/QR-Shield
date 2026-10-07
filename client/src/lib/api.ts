import type { AnalysisResult, HistoryResponse, ScanListItem, StatsResponse, ScanSource } from "./types";
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the QR Shield API. Make sure the server is running (npm run dev).");
  }

  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string; ai: boolean }>("/api/health"),

  scan: (payload: string, source: ScanSource = "manual") =>
    request<AnalysisResult & { id: number }>("/api/scan", {
      method: "POST",
      body: JSON.stringify({ payload, source }),
    }),

  /** Analyze without persisting (demo cases, preview). */
  analyze: (payload: string) =>
    request<AnalysisResult>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ payload }),
    }),

  decodeImage: async (dataUrl: string, mimeType: string): Promise<string> => {
    const res = await request<{ ok: boolean; text: string }>("/api/decode", {
      method: "POST",
      body: JSON.stringify({ image: dataUrl, mimeType }),
    });
    return res.text;
  },

  history: (params: {
    q?: string;
    classification?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.classification && params.classification !== "ALL") qs.set("classification", params.classification);
    if (params.sort && params.sort !== "newest") qs.set("sort", params.sort);
    qs.set("limit", String(params.limit ?? 25));
    qs.set("offset", String(params.offset ?? 0));
    return request<HistoryResponse>(`/api/history?${qs.toString()}`);
  },

  scanDetail: (id: number) => request<ScanListItem & { detectors: AnalysisResult["detectors"] }>(`/api/scan/${id}`),

  deleteScan: (id: number) => request<{ deleted: boolean }>(`/api/scan/${id}`, { method: "DELETE" }),

  clearHistory: () => request<{ deleted: number }>("/api/history", { method: "DELETE" }),

  stats: () => request<StatsResponse>("/api/stats"),
};
