import type { RunStatus } from "./api";

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "queued",
  running: "running",
  needs_input: "needs input",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/** A recorded or started time as a fixed UTC date: "14 Nov 2026, 20:04 UTC". Never relative, so recordings read correctly. */
export function formatRecorded(iso: string): string {
  const text = new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${text} UTC`;
}

/** "4.1s" under a minute, "1m 04s" above. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

export function shortRepo(repo: string): string {
  const trimmed = repo.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || repo;
}
