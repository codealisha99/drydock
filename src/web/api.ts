export type RunStatus = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";

export interface Run {
  id: string;
  repo: string;
  baseBranch: string;
  workBranch: string;
  instruction: string;
  delivery: "local" | "github";
  status: RunStatus;
  summary: string | null;
  hasSandbox: boolean;
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PullRequest {
  id: number;
  provider: "local" | "github";
  url: string;
  number: number | null;
  branch: string;
  baseBranch: string;
  title: string;
  diff: string;
  createdAt: string;
}

export interface RunDetail {
  run: Run;
  latestDiff: { diff: string; baseSha: string; headSha: string } | null;
  pullRequests: PullRequest[];
}

export interface StreamEvent {
  runId: string;
  seq: number;
  type: "status" | "user_message" | "model_text" | "tool_call" | "tool_result" | "diff" | "delivery" | "outcome" | "error";
  data: Record<string, unknown>;
  createdAt: string;
}

export interface NewRunInput {
  repo: string;
  branch: string;
  instruction: string;
  delivery: "local" | "github";
}

/** Thin JSON client. Server errors ({error}) surface as plain Error messages. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `request failed (HTTP ${res.status})`);
  return body;
}

export const api = {
  listRuns: () => request<{ runs: Run[] }>("/api/runs"),
  inbox: () => request<{ runs: Run[] }>("/api/inbox"),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  createRun: (input: NewRunInput) => request<{ run: Run }>("/api/runs", { method: "POST", body: JSON.stringify(input) }),
  cancelRun: (id: string) => request<{ run: Run }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  followUp: (id: string, message: string) =>
    request<{ run: Run }>(`/api/runs/${id}/messages`, { method: "POST", body: JSON.stringify({ message }) }),
};
