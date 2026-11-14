import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type RunStatus = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
export const TERMINAL_STATUSES: readonly RunStatus[] = ["needs_input", "succeeded", "failed", "cancelled"];
export const INBOX_STATUSES: readonly RunStatus[] = ["needs_input", "failed"];

export interface RunRow {
  id: string;
  repo_input: string;
  clone_url: string;
  local_remote: string | null;
  base_branch: string;
  work_branch: string;
  instruction: string;
  delivery: "local" | "github";
  status: RunStatus;
  summary: string | null;
  base_sha: string | null;
  delivered_sha: string | null;
  container_name: string | null;
  messages: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  data: string;
  created_at: string;
}

export interface PullRequestRow {
  id: number;
  run_id: string;
  provider: "local" | "github";
  url: string;
  number: number | null;
  branch: string;
  base_branch: string;
  title: string;
  diff: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  repo_input TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  local_remote TEXT,
  base_branch TEXT NOT NULL,
  work_branch TEXT NOT NULL,
  instruction TEXT NOT NULL,
  delivery TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  base_sha TEXT,
  delivered_sha TEXT,
  container_name TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  number INTEGER,
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  title TEXT NOT NULL,
  diff TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** Opens (creating if needed) the SQLite database. Pass ":memory:" in tests. */
export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
