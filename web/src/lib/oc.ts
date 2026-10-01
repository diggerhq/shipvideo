// Minimal client for the OpenComputer managed-agents API (the same endpoints
// the opencomputer CLI uses).
const API = process.env.OPENCOMPUTER_API_URL ?? "https://app.opencomputer.dev";

function key(): string {
  const k = process.env.OPENCOMPUTER_API_KEY;
  if (!k) throw new Error("OPENCOMPUTER_API_KEY is not set");
  return k;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-api-key": key(), "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenComputer ${init.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type OcEvent = { id: string; seq: number; type: string; data: Record<string, unknown> };
export type OcSession = { id: string; status: string; microvmState?: string; turns?: Array<{ id: string; status: string }> };

export function agentId(): string {
  return process.env.OC_AGENT_ID ?? "director@development";
}

export async function createSession(): Promise<OcSession> {
  const result = await request<{ session: OcSession }>("/api/managed-agents/sessions", {
    method: "POST",
    body: JSON.stringify({ agentId: agentId() }),
  });
  return result.session;
}

export function getSession(sessionId: string): Promise<OcSession> {
  return request<OcSession>(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}`);
}

export async function events(sessionId: string, after = 0): Promise<OcEvent[]> {
  const result = await request<{ events: OcEvent[] }>(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`);
  return result.events;
}

export function createTurn(sessionId: string, input: string, idempotencyKey: string) {
  return request<{ turnId: string; duplicate: boolean }>(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: "POST",
    body: JSON.stringify({ input, idempotencyKey }),
  });
}

export type WorkspaceDownload = { path: string; size: number; url: string; expiresAt: string; mediaType: string };

// Authorizes a signed download of one file the agent wrote under /workspace.
// Returns null while the file is not there yet (404 artifact_not_found).
export async function workspaceDownload(sessionId: string, path: string): Promise<WorkspaceDownload | null> {
  const res = await fetch(`${API}/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/workspace/download`, {
    method: "POST",
    headers: { "x-api-key": key(), "content-type": "application/json" },
    body: JSON.stringify({ path }),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenComputer workspace download failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as WorkspaceDownload;
}

export function endSession(sessionId: string) {
  return request(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" }).catch(() => undefined);
}

export async function waitForRuntime(sessionId: string, timeoutMs = 90_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;
  while (Date.now() < deadline) {
    const batch = await events(sessionId, cursor);
    for (const event of batch) {
      cursor = Math.max(cursor, event.seq);
      if (event.type === "runtime.disconnected") throw new Error(String(event.data.reason ?? "The agent runtime disconnected."));
      if (event.type === "runtime.connected") return cursor;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("The agent runtime did not start in time.");
}
