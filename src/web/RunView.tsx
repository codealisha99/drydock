import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type RunDetail, type StreamEvent } from "./api";
import { DiffView } from "./DiffView";
import { ago } from "./format";
import { StatusMark } from "./StatusMark";
import { Timeline } from "./Timeline";
import { buildTimeline } from "./timeline-model";

const ACTIVE = ["queued", "running"] as const;

/** Keeps one EventSource per run and dedupes by seq, so reconnect replays are harmless. */
function useRunEvents(runId: string, onSignal: () => void) {
  const [events, setEvents] = useState<Map<number, StreamEvent>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents(new Map());
    const source = new EventSource(`/api/runs/${runId}/events?after=0`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const onMessage = (msg: MessageEvent<string>) => {
      const event = JSON.parse(msg.data) as StreamEvent;
      setEvents((prev) => {
        if (prev.has(event.seq)) return prev;
        return new Map(prev).set(event.seq, event);
      });
      if (event.type === "outcome" || event.type === "delivery" || event.type === "status") onSignal();
    };
    const types = ["status", "user_message", "model_text", "tool_call", "tool_result", "diff", "delivery", "outcome", "error"];
    for (const t of types) source.addEventListener(t, onMessage as EventListener);
    return () => source.close();
  }, [runId, onSignal]);

  const ordered = useMemo(() => [...events.values()].sort((a, b) => a.seq - b.seq), [events]);
  return { ordered, connected };
}

function FollowUp({ runId, onSent }: { runId: string; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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

export function RunView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
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

  const { ordered, connected } = useRunEvents(runId, refresh);
  const items = useMemo(() => buildTimeline(ordered), [ordered]);
  const latestDiff = [...ordered].reverse().find((e) => e.type === "diff")?.data.diff as string | undefined;

  if (missing) return <p className="muted">That run does not exist. <button className="link-button" onClick={onBack}>Back to runs</button></p>;
  if (!detail) return <p className="muted">Loading run…</p>;
  const { run, pullRequests } = detail;
  const active = (ACTIVE as readonly string[]).includes(run.status);
  const canFollowUp = !active && run.hasSandbox;

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
            <span className={`stream ${connected ? "is-live" : ""}`}>{connected ? "live" : "reconnecting"}</span>
          </div>
          <Timeline items={items} connected={connected} />
          {canFollowUp ? (
            <FollowUp runId={run.id} onSent={refresh} />
          ) : !active && !run.hasSandbox ? (
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
