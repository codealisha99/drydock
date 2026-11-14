export interface RunQueueOptions {
  concurrency: number;
  work: (runId: string, signal: AbortSignal) => Promise<void>;
  onError?: (runId: string, err: unknown) => void;
}

/**
 * In-process FIFO with a concurrency cap. Each active run gets an AbortController so cancel
 * can stop it mid-command. Queue state is rebuilt from SQLite on boot (see engine.recover).
 */
export class RunQueue {
  private readonly pending: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly rerun = new Set<string>();

  constructor(private readonly opts: RunQueueOptions) {}

  enqueue(runId: string): void {
    if (this.active.has(runId)) {
      // Still finishing its previous turn: run again as soon as it releases its slot.
      this.rerun.add(runId);
      return;
    }
    if (this.pending.includes(runId)) return;
    this.pending.push(runId);
    this.pump();
  }

  /** Removes a queued (not yet started) run. Returns false if it is not waiting. */
  cancelPending(runId: string): boolean {
    const idx = this.pending.indexOf(runId);
    if (idx === -1) return false;
    this.pending.splice(idx, 1);
    return true;
  }

  /** Aborts a running run. Returns false if it is not running here. */
  abort(runId: string): boolean {
    const ctrl = this.active.get(runId);
    if (!ctrl) return false;
    ctrl.abort();
    return true;
  }

  abortAll(): void {
    for (const ctrl of this.active.values()) ctrl.abort();
  }

  stats(): { pending: number; active: number } {
    return { pending: this.pending.length, active: this.active.size };
  }

  private pump(): void {
    while (this.active.size < this.opts.concurrency && this.pending.length > 0) {
      const runId = this.pending.shift()!;
      const ctrl = new AbortController();
      this.active.set(runId, ctrl);
      this.opts
        .work(runId, ctrl.signal)
        .catch((err: unknown) => this.opts.onError?.(runId, err))
        .finally(() => {
          this.active.delete(runId);
          if (this.rerun.delete(runId)) this.pending.push(runId);
          this.pump();
        });
    }
  }
}
