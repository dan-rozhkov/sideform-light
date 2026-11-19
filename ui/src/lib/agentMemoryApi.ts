import { apiFetch } from "@/lib/apiBase";
import { getRequestUserId } from "@/lib/auth/authState";

export type MemoryTarget = "memory" | "user";

export interface AgentMemory {
  /** False when the backend has no memory store (503, or a 200 saying so): not an error. */
  available: boolean;
  enabled: boolean;
  memory: string[];
  user: string[];
  limits: { memory: number; user: number };
}

export type MemoryResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const JSON_HEADERS = { "Content-Type": "application/json" };

function url(path: string): string {
  return `${path}?${new URLSearchParams({ userId: getRequestUserId() }).toString()}`;
}

/** Never throws: network failures and non-2xx answers become `{ ok: false }`. */
async function request<T>(path: string, init?: RequestInit): Promise<MemoryResult<T>> {
  let res: Response;
  try {
    res = await apiFetch(url(path), init);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status };
  }
  return { ok: true, data: body as T };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The backend's usage rule: entries joined with "\n§\n". */
export function memoryUsage(entries: string[]): number {
  return entries.join("\n§\n").length;
}

/** GET /api/memory. A 503 or 404 is "memory not available", reported as `available: false`. */
export async function fetchAgentMemory(): Promise<MemoryResult<AgentMemory>> {
  const res = await request<Partial<AgentMemory>>("/api/memory");
  if (!res.ok) {
    if (res.status === 503 || res.status === 404) {
      return { ok: true, data: { available: false, enabled: false, memory: [], user: [], limits: { memory: 0, user: 0 } } };
    }
    return res;
  }
  const d = res.data ?? {};
  return {
    ok: true,
    data: {
      available: d.available === true,
      enabled: d.enabled !== false,
      memory: strings(d.memory),
      user: strings(d.user),
      limits: { memory: d.limits?.memory ?? 0, user: d.limits?.user ?? 0 },
    },
  };
}

/** DELETE /api/memory/entry. A 404 (already gone) comes back as an error with `status: 404`. */
export function deleteMemoryEntry(target: MemoryTarget, text: string): Promise<MemoryResult<{ removed: true }>> {
  return request("/api/memory/entry", { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ target, text }) });
}

/** DELETE /api/memory */
export function clearAgentMemory(): Promise<MemoryResult<{ cleared: { memory: number; user: number } }>> {
  return request("/api/memory", { method: "DELETE" });
}

/** PUT /api/memory/settings */
export function setAgentMemoryEnabled(enabled: boolean): Promise<MemoryResult<{ enabled: boolean }>> {
  return request("/api/memory/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ enabled }) });
}
