import type { PullRequestRow, RunRow } from "./db";
import type { RunEvent } from "./events";

/** Shapes shared by the live API and the read-only showcase. No database or process imports here. */
export function toRunDto(run: RunRow) {
  return {
    id: run.id,
    repo: run.repo_input,
    baseBranch: run.base_branch,
    workBranch: run.work_branch,
    instruction: run.instruction,
    delivery: run.delivery,
    status: run.status,
    summary: run.summary,
    hasSandbox: run.container_name !== null,
    needsAttention: run.status === "needs_input" || run.status === "failed",
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

export function toPullRequestDto(pr: PullRequestRow) {
  return {
    id: pr.id,
    provider: pr.provider,
    url: pr.url,
    number: pr.number,
    branch: pr.branch,
    baseBranch: pr.base_branch,
    title: pr.title,
    diff: pr.diff,
    createdAt: pr.created_at,
  };
}

export function sseFrame(runId: string, e: RunEvent) {
  return { id: String(e.seq), event: e.type, data: JSON.stringify({ runId, seq: e.seq, type: e.type, data: e.data, createdAt: e.createdAt }) };
}
