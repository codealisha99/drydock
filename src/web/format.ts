import type { RunStatus } from "./api";

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "queued",
  running: "running",
  needs_input: "needs input",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function firstLine(text: string, max = 96): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function shortRepo(repo: string): string {
  const trimmed = repo.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || repo;
}
