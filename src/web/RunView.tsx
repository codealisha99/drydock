import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, SHOWCASE_REFUSAL, type RunDetail, type StreamEvent } from "./api";
import { DiffView } from "./DiffView";
import { ago } from "./format";
import { StatusMark } from "./StatusMark";
import { Timeline } from "./Timeline";
import { buildTimeline } from "./timeline-model";

const ACTIVE = ["queued", "running"] as const;

export type Pace = "recorded" | "slow";
const TERMINAL = ["succeeded", "needs_input", "failed", "cancelled"];

/**
 * Keeps one EventSource per run and dedupes by seq, so reconnect replays are harmless.
 * A showcase replay is finite: it closes on the run's terminal status so the browser does not reconnect and start over.
 */
function useRunEvents(runId: string, onSignal: () => void, pace: Pace, showcase: boolean) {
  const [events, setEvents] = useState<Map<number, StreamEvent>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents(new Map());
    const slow = pace === "slow" ? "&pace=slow" : "";
    const source = new EventSource(`/api/runs/${runId}/events?after=0${slow}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const onMessage = (msg: MessageEvent<string>) => {
      const event = JSON.parse(msg.data) as StreamEvent;
      setEvents((prev) => {
        if (prev.has(event.seq)) return prev;
        return new Map(prev).set(event.seq, event);
      });
      if (event.type === "outcome" || event.type === "delivery" || event.type === "status") onSignal();
      if (showcase && event.type === "status" && TERMINAL.includes(String(event.data.status))) source.close();
    };
    const types = ["status", "user_message", "model_text", "tool_call", "tool_result", "diff", "delivery", "outcome", "error"];
    for (const t of types) source.addEventListener(t, onMessage as EventListener);
    return () => source.close();
  }, [runId, onSignal, pace, showcase]);

  const ordered = useMemo(() => [...events.values()].sort((a, b) => a.seq - b.seq), [events]);
  return { ordered, connected };
}

function FollowUp({ runId, onSent, showcase }: { runId: string; onSent: () => void; showcase: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (showcase) return setError(SHOWCASE_REFUSAL);
    try {
      await api.followUp(runId, message);
      setMessage("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not send");
    }
  };
  return (
    <form className="followup" onSubmit={submit}>
      <label>
        <span>Follow up on this run</span>
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Answer the question, or ask for a change on the same branch." required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary">Send follow-up</button>
      </div>
    </form>
  );
}

export function RunView({ runId, onBack, showcase }: { runId: string; onBack: () => void; showcase: boolean }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [pace, setPace] = useState<Pace>("recorded");
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getRun(runId));
    } catch {
      setMissing(true);
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { ordered, connected } = useRunEvents(runId, refresh, pace, showcase);
  const items = useMemo(() => buildTimeline(ordered), [ordered]);
  const latestDiff = [...ordered].reverse().find((e) => e.type === "diff")?.data.diff as string | undefined;

  if (missing) return <p className="muted">That run does not exist. <button className="link-button" onClick={onBack}>Back to runs</button></p>;
  if (!detail) return <p className="muted">Loading run…</p>;
  const { run, pullRequests } = detail;
  const active = (ACTIVE as readonly string[]).includes(run.status);
  // In showcase mode the follow-up form stays visible so the refusal message is shown where the user acts.
  const canFollowUp = !active && (run.hasSandbox || showcase);

  const cancel = async () => {
    setActionError(null);
    try {
      await api.cancelRun(run.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "could not cancel");
    }
  };

  return (
    <div className="run">
      <header className="run-head">
        <button className="link-button" onClick={onBack}>All runs</button>
        <h1>{run.instruction.split("\n")[0]}</h1>
        <dl className="run-meta">
          <div><dt>Repository</dt><dd className="mono">{run.repo}</dd></div>
          <div><dt>Branch</dt><dd className="mono">{run.baseBranch} → {run.workBranch}</dd></div>
          <div><dt>Delivery</dt><dd>{run.delivery === "github" ? "GitHub pull request" : "Local bare remote"}</dd></div>
          <div><dt>Started</dt><dd className="mono">{ago(run.createdAt)}</dd></div>
        </dl>
        <div className="run-state">
          <StatusMark status={run.status} />
          {run.summary && <p className="run-summary">{run.summary}</p>}
          {active && (
            <button type="button" className="danger" onClick={cancel}>Cancel run</button>
          )}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </header>

      <div className="run-body">
        <section className="run-timeline" aria-labelledby="timeline-title">
          <div className="section-head">
            <h2 id="timeline-title">Timeline</h2>
            <span className={`stream ${connected ? "is-live" : ""}`}>{connected ? (showcase ? "replaying" : "live") : "reconnecting"}</span>
          </div>
          {showcase && (
            <div className="pace" role="group" aria-label="Replay speed">
              <span className="muted">Replay speed</span>
              <button type="button" aria-pressed={pace === "recorded"} onClick={() => setPace("recorded")}>Recorded pace</button>
              <button type="button" aria-pressed={pace === "slow"} onClick={() => setPace("slow")}>Slowed 4x, same order</button>
            </div>
          )}
          <Timeline items={items} connected={connected} />
          {canFollowUp ? (
            <FollowUp runId={run.id} onSent={refresh} showcase={showcase} />
          ) : !active && !run.hasSandbox && !showcase ? (
            <p className="muted">The sandbox for this run was cleaned up. Start a new run to continue this work.</p>
          ) : null}
        </section>

        <aside className="run-side">
          <section aria-labelledby="delivery-title">
            <h2 id="delivery-title">Delivery</h2>
            {pullRequests.length === 0 ? (
              <p className="muted">Nothing delivered yet.</p>
            ) : (
              <ul className="prs">
                {pullRequests.map((pr) => (
                  <li key={pr.id}>
                    {pr.provider === "github" ? (
                      <a href={pr.url} target="_blank" rel="noreferrer">{`Pull request${pr.number ? ` #${pr.number}` : ""}`}</a>
                    ) : (
                      <span>Branch on local remote</span>
                    )}
                    <span className="mono muted">{pr.branch}</span>
                    {pr.provider === "local" && <span className="mono muted break">{pr.url.split("#")[0]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="diff-title">
            <h2 id="diff-title">Changes</h2>
            <DiffView diff={latestDiff ?? detail.latestDiff?.diff ?? null} />
          </section>
        </aside>
      </div>
    </div>
  );
}
