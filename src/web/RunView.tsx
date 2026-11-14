import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, SHOWCASE_REFUSAL, type RunDetail, type StreamEvent } from "./api";
import { DiffView } from "./DiffView";
import { ago } from "./format";
import { ShowcaseExplainer } from "./HomeView";
import { StatusMark } from "./StatusMark";
import { Timeline } from "./Timeline";
import { buildTimeline } from "./timeline-model";

const ACTIVE = ["queued", "running"] as const;
const TERMINAL = ["succeeded", "needs_input", "failed", "cancelled"];
const EVENT_TYPES = ["status", "user_message", "model_text", "tool_call", "tool_result", "diff", "delivery", "outcome", "error"];

/** "slow" is the default in showcase mode so a visitor can follow the run; "recorded" uses the recorded gaps. */
export type Pace = "slow" | "recorded";

interface ReplayState {
  pace: Pace;
  /** Bumped to start over: clears the timeline and reconnects from the first event. */
  generation: number;
  playing: boolean;
}

/**
 * One EventSource per run, deduped by seq. Pausing closes the stream; resuming reconnects with
 * ?after= the last seq seen, so nothing is lost or repeated. A showcase replay closes on the
 * terminal status so the browser does not reconnect and start over.
 */
function useRunEvents(runId: string, onSignal: () => void, replay: ReplayState, showcase: boolean) {
  const [events, setEvents] = useState<Map<number, StreamEvent>>(new Map());
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    setEvents(new Map());
    lastSeq.current = 0;
    setFinished(false);
  }, [replay.generation]);

  useEffect(() => {
    if (!replay.playing || finished) return;
    const slow = showcase && replay.pace === "slow" ? "&pace=slow" : "";
    const source = new EventSource(`/api/runs/${runId}/events?after=${lastSeq.current}${slow}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const onMessage = (msg: MessageEvent<string>) => {
      const event = JSON.parse(msg.data) as StreamEvent;
      lastSeq.current = Math.max(lastSeq.current, event.seq);
      setEvents((prev) => (prev.has(event.seq) ? prev : new Map(prev).set(event.seq, event)));
      if (event.type === "outcome" || event.type === "delivery" || event.type === "status") onSignal();
      if (showcase && event.type === "status" && TERMINAL.includes(String(event.data.status))) {
        setFinished(true);
        source.close();
      }
    };
    for (const t of EVENT_TYPES) source.addEventListener(t, onMessage as EventListener);
    return () => source.close();
  }, [runId, onSignal, replay.playing, replay.pace, replay.generation, finished, showcase]);

  const ordered = useMemo(() => [...events.values()].sort((a, b) => a.seq - b.seq), [events]);
  return { ordered, connected, finished };
}

function ReplayBar({
  replay,
  finished,
  connected,
  onPlayPause,
  onReplay,
  onPace,
}: {
  replay: ReplayState;
  finished: boolean;
  connected: boolean;
  onPlayPause: () => void;
  onReplay: () => void;
  onPace: (pace: Pace) => void;
}) {
  const state = finished ? "Replay finished" : !replay.playing ? "Paused" : connected ? "Replaying" : "Starting";
  return (
    <div className="replay-bar">
      <div className="replay-controls">
        <button type="button" className="ghost" onClick={onPlayPause} disabled={finished} aria-label={replay.playing ? "Pause replay" : "Resume replay"}>
          {replay.playing ? "Pause" : "Resume"}
        </button>
        <button type="button" className="ghost" onClick={onReplay}>Replay from start</button>
      </div>
      <div className="pace" role="group" aria-label="Replay speed">
        <button type="button" aria-pressed={replay.pace === "slow"} onClick={() => onPace("slow")}>Slowed 4x</button>
        <button type="button" aria-pressed={replay.pace === "recorded"} onClick={() => onPace("recorded")}>Recorded pace</button>
      </div>
      <p className="replay-state" role="status">
        {state}
        {replay.pace === "slow" && replay.playing && !finished ? ", slowed 4x from the recorded gaps" : ""}
      </p>
    </div>
  );
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
      setError(err instanceof Error ? err.message : "Could not send the follow-up.");
    }
  };
  return (
    <form className="followup" onSubmit={submit} aria-labelledby="followup-title">
      <h3 id="followup-title">Follow up on this run</h3>
      {showcase && <ShowcaseExplainer />}
      <fieldset className="form-fields" disabled={showcase}>
        <label>
          <span className="sr-only">Follow-up message</span>
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Answer the question, or ask for a change on the same branch." required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={showcase}>Send follow-up</button>
        </div>
      </fieldset>
    </form>
  );
}

export function RunView({ runId, onBack, showcase }: { runId: string; onBack: () => void; showcase: boolean }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [replay, setReplay] = useState<ReplayState>({ pace: "slow", generation: 0, playing: true });
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDetail(await api.getRun(runId));
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { ordered, connected, finished } = useRunEvents(runId, refresh, replay, showcase);
  const items = useMemo(() => buildTimeline(ordered), [ordered]);
  const latestDiff = [...ordered].reverse().find((e) => e.type === "diff")?.data.diff as string | undefined;

  if (missing) {
    return (
      <div className="state">
        <p>No run with that id. It may have been removed when its sandbox was cleaned up.</p>
        <button type="button" className="link-button" onClick={onBack}>Back to runs</button>
      </div>
    );
  }
  if (!detail) return <p className="state muted" role="status">Loading run…</p>;
  const { run, pullRequests } = detail;
  const active = (ACTIVE as readonly string[]).includes(run.status);
  const canFollowUp = !active && (run.hasSandbox || showcase);

  const cancel = async () => {
    setActionError(null);
    try {
      await api.cancelRun(run.id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not cancel the run.");
    }
  };

  const setPace = (pace: Pace) => setReplay((r) => ({ ...r, pace, generation: r.generation + 1, playing: true }));
  const replayFromStart = () => setReplay((r) => ({ ...r, generation: r.generation + 1, playing: true }));
  const togglePlaying = () => setReplay((r) => ({ ...r, playing: !r.playing }));

  return (
    <div className="run">
      <header className="run-head">
        <button type="button" className="link-button" onClick={onBack}>All runs</button>
        <h1>{run.instruction.split("\n")[0]}</h1>
        <dl className="run-meta">
          <div><dt>Repository</dt><dd className="mono">{run.repo}</dd></div>
          <div><dt>Branch</dt><dd className="mono">{run.baseBranch} to {run.workBranch}</dd></div>
          <div><dt>Delivery</dt><dd>{run.delivery === "github" ? "GitHub pull request" : "Local bare remote"}</dd></div>
          <div><dt>Started</dt><dd>{ago(run.createdAt)}</dd></div>
        </dl>
        <div className="run-state">
          <StatusMark status={run.status} />
          {run.summary && <p className="run-summary">{run.summary}</p>}
          {active && <button type="button" className="danger" onClick={cancel}>Cancel run</button>}
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </header>

      <div className="run-body">
        <section className="run-timeline" aria-labelledby="timeline-title">
          <div className="section-head">
            <h2 id="timeline-title">Timeline</h2>
            {!showcase && <span className={`stream ${connected ? "is-live" : ""}`}>{connected ? "live" : "reconnecting"}</span>}
          </div>
          {showcase && (
            <ReplayBar replay={replay} finished={finished} connected={connected} onPlayPause={togglePlaying} onReplay={replayFromStart} onPace={setPace} />
          )}
          <Timeline items={items} connected={connected} live={!showcase} />
          {canFollowUp && <FollowUp runId={run.id} onSent={refresh} showcase={showcase} />}
          {!active && !run.hasSandbox && !showcase && (
            <p className="muted">The sandbox for this run was cleaned up. Start a new run to continue this work.</p>
          )}
        </section>

        <aside className="run-side">
          <section className="side-block" aria-labelledby="delivery-title">
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
                      <span>Branch on the local remote</span>
                    )}
                    <span className="mono muted">{pr.branch}</span>
                    {pr.provider === "local" && <span className="mono muted break">{pr.url.split("#")[0]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="side-block" aria-labelledby="diff-title">
            <h2 id="diff-title">Changes</h2>
            <DiffView diff={latestDiff ?? detail.latestDiff?.diff ?? null} />
          </section>
        </aside>
      </div>
    </div>
  );
}
