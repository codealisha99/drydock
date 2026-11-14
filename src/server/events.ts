import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";

export type RunEventType =
  | "status"
  | "user_message"
  | "model_text"
  | "tool_call"
  | "tool_result"
  | "diff"
  | "delivery"
  | "outcome"
  | "error";

export interface RunEvent {
  runId: string;
  seq: number;
  type: RunEventType;
  data: unknown;
  createdAt: string;
}

export interface EventLog {
  append(runId: string, type: RunEventType, data: unknown): RunEvent;
  list(runId: string, afterSeq: number): RunEvent[];
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
}

/** Persists run events in SQLite (replayable after reconnect) and fans them out live. */
export function createEventLog(db: DatabaseSync): EventLog {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const insert = db.prepare("INSERT INTO events (run_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)");
  const nextSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE run_id = ?");
  const select = db.prepare("SELECT run_id, seq, type, data, created_at FROM events WHERE run_id = ? AND seq > ? ORDER BY seq");

  const toEvent = (row: Record<string, unknown>): RunEvent => ({
    runId: String(row.run_id),
    seq: Number(row.seq),
    type: String(row.type) as RunEventType,
    data: JSON.parse(String(row.data)),
    createdAt: String(row.created_at),
  });

  return {
    append(runId, type, data) {
      const createdAt = new Date().toISOString();
      const payload = JSON.stringify(data ?? null);
      // Single-threaded and synchronous: MAX+1 cannot race within this process.
      const seq = Number((nextSeq.get(runId) as { next: number }).next);
      insert.run(runId, seq, type, payload, createdAt);
      const event: RunEvent = { runId, seq, type, data, createdAt };
      bus.emit(runId, event);
      return event;
    },
    list(runId, afterSeq) {
      return (select.all(runId, afterSeq) as Record<string, unknown>[]).map(toEvent);
    },
    subscribe(runId, listener) {
      bus.on(runId, listener);
      return () => {
        bus.off(runId, listener);
      };
    },
  };
}
