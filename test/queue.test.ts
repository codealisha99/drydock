import { describe, expect, it } from "vitest";
import { RunQueue } from "../src/server/queue";

type Gate = { id: string; resolve: () => void; signal: AbortSignal };

function gatedQueue(concurrency: number) {
  const started: Gate[] = [];
  const queue = new RunQueue({
    concurrency,
    work: (id, signal) =>
      new Promise<void>((resolve) => {
        started.push({ id, resolve, signal });
      }),
  });
  return { queue, started };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("RunQueue", () => {
  it("never runs more than the concurrency limit at once", async () => {
    const { queue, started } = gatedQueue(2);
    ["a", "b", "c"].forEach((id) => queue.enqueue(id));
    await tick();
    expect(started.map((g) => g.id)).toEqual(["a", "b"]);
    expect(queue.stats()).toEqual({ pending: 1, active: 2 });
    started[0]!.resolve();
    await tick();
    expect(started.map((g) => g.id)).toEqual(["a", "b", "c"]);
  });

  it("removes a waiting run on cancelPending", async () => {
    const { queue, started } = gatedQueue(1);
    queue.enqueue("a");
    queue.enqueue("b");
    await tick();
    expect(queue.cancelPending("b")).toBe(true);
    expect(queue.cancelPending("b")).toBe(false);
    started[0]!.resolve();
    await tick();
    expect(started.map((g) => g.id)).toEqual(["a"]);
  });

  it("aborts an active run through its signal", async () => {
    const { queue, started } = gatedQueue(1);
    queue.enqueue("a");
    await tick();
    expect(queue.abort("a")).toBe(true);
    expect(started[0]!.signal.aborted).toBe(true);
    expect(queue.abort("missing")).toBe(false);
  });

  it("runs an id again if it is enqueued while still active", async () => {
    const { queue, started } = gatedQueue(1);
    queue.enqueue("a");
    await tick();
    queue.enqueue("a");
    started[0]!.resolve();
    await tick();
    expect(started.map((g) => g.id)).toEqual(["a", "a"]);
  });
});
