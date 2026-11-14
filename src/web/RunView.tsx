import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { api, SHOWCASE_REFUSAL, type RunDetail, type StreamEvent } from "./api";
import { DiffView } from "./DiffView";
import { changesLine, durationLine, testsLine } from "./facts";
import { formatRecorded, shortRepo } from "./format";
import { LOCAL_RUN_COMMAND } from "./local-run";
import { StatusMark } from "./StatusMark";
import { CommandLine } from "./CommandLine";
import { Timeline } from "./Timeline";
import { buildTimeline } from "./timeline-model";

const ACTIVE = ["queued", "running"] as const;
const TERMINAL = ["succeeded", "needs_input", "failed", "cancelled"];
const EVENT_TYPES = ["status", "user_message", "model_text", "tool_call", "tool_result", "diff", "delivery", "outcome", "error"];
/** Within this many pixels of the bottom, new steps keep the page scrolled to them. */
const FOLLOW_SLACK_PX = 160;

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
 * ?after= the last seq seen, so nothing is lost or repeated. A showcase replay ends on the server's
 * done frame, after every turn, so the browser never reconnects and starts over.
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
    };
    for (const t of EVENT_TYPES) source.addEventListener(t, onMessage as EventListener);
    // Only the showcase sends done. It is listened for regardless of mode, because the mode arrives after mount.
    source.addEventListener("done", () => {
      setFinished(true);
      source.close();
    });
    return () => source.close();
  }, [runId, onSignal, replay.playing, replay.pace, replay.generation, finished, showcase]);

  const ordered = useMemo(() => [...events.values()].sort((a, b) => a.seq - b.seq), [events]);
  return { ordered, connected, finished };
}

function ReplayBar({
  replay,
  finished,
  received,
  total,
  onPlayPause,
  onReplay,
  onPace,
}: {
  replay: ReplayState;
  finished: boolean;
  received: number;
  total: number;
  onPlayPause: () => void;
  onReplay: () => void;
  onPace: (pace: Pace) => void;
}) {
  const state = finished ? "Replay finished" : !replay.playing ? "Paused" : "Replaying";
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  return (
    <div className="replay-bar">
      <div className="replay-row">
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
      </div>
      <div className="progress-row">
        <p className="replay-state" role="status">
          {state}
          {replay.pace === "slow" && replay.playing && !finished ? ", slowed 4x" : ""}
        </p>
        <span className="progress-count">{received} of {total} events</span>
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
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
  if (showcase) {
    return (
      <section className="followup is-disabled" aria-labelledby="followup-title">
        <h3 id="followup-title">Follow up on this run</h3>
        <p className="muted">A follow-up continues this run on its own sandbox. This copy replays recorded runs, so run it locally to send one:</p>
        <CommandLine command={LOCAL_RUN_COMMAND} />
      </section>
    );
  }
  return (
    <form className="followup" onSubmit={submit} aria-labelledby="followup-title">
      <h3 id="followup-title">Follow up on this run</h3>
      <label>
        <span className="sr-only">Follow-up message</span>
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Answer the question, or ask for a change on the same branch." required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary">Send follow-up</button>
      </div>
    </form>
  );
}

export function RunView({ runId, onBack, showcase, linkTo }: { runId: string; onBack: () => void; showcase: boolean; linkTo: (path: string) => (e: MouseEvent) => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [replay, setReplay] = useState<ReplayState>({ pace: "slow", generation: 0, playing: true });
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);

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
  const active = detail ? (ACTIVE as readonly string[]).includes(detail.run.status) : false;
  const streaming = showcase ? replay.playing && !finished : active;

  // Auto-follow: new steps scroll into view while the reader is at the bottom. Scrolling up breaks out.
  useEffect(() => {
    // Only the reader scrolling up breaks follow; going down, or the page settling, does not.
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const gap = document.documentElement.scrollHeight - window.innerHeight - y;
      if (gap < FOLLOW_SLACK_PX) followRef.current = true;
      else if (y < lastY) followRef.current = false;
      lastY = y;
      setFollow(followRef.current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (followRef.current && streaming) endRef.current?.scrollIntoView({ block: "end" });
  }, [ordered.length, streaming]);
  const jumpToLatest = () => {
    followRef.current = true;
    setFollow(true);
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  if (missing) {
    return (
      <section className="state not-found" aria-labelledby="missing-title">
        <h1 id="missing-title">No run with that id</h1>
        <p>It may have been removed when its sandbox was cleaned up. <a href="/" onClick={linkTo("/")}>Back to all runs</a>.</p>
      </section>
    );
  }
  if (!detail) return <p className="state muted" role="status">Loading run…</p>;
  const { run, pullRequests } = detail;
  const tests = testsLine(run.facts);
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
      <header className="run-outcome">
        <a href="/" className="back-link" onClick={linkTo("/")}>All runs</a>
        <div className="outcome-top">
          <StatusMark status={run.status} />
          <h1>{run.instruction.split("\n")[0]}</h1>
        </div>
        {run.summary && <p className="outcome-summary">{run.summary}</p>}
        <dl className="outcome-facts">
          <div><dt>Duration</dt><dd>{durationLine(run.facts)}</dd></div>
          <div><dt>Changes</dt><dd>{changesLine(run.facts)}</dd></div>
          <div><dt>Tests</dt><dd>{tests ?? "None run"}</dd></div>
          <div><dt>Steps</dt><dd>{run.facts.steps}</dd></div>
          <div><dt>Branch</dt><dd className="mono">{run.workBranch}</dd></div>
          <div><dt>Repository</dt><dd>{shortRepo(run.repo)} <span className="muted">· {run.baseBranch}</span></dd></div>
          <div><dt>Started</dt><dd>{formatRecorded(run.createdAt)}</dd></div>
        </dl>
        <div className="outcome-actions">
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
          {showcase ? (
            <ReplayBar
              replay={replay}
              finished={finished}
              received={ordered.length}
              total={run.facts.events}
              onPlayPause={togglePlaying}
              onReplay={replayFromStart}
              onPace={setPace}
            />
          ) : null}
          <Timeline items={items} connected={connected} streaming={streaming} />
          <div ref={endRef} className="timeline-end" aria-hidden="true" />
          {streaming && !follow && (
            <button type="button" className="jump" onClick={jumpToLatest}>Jump to latest</button>
          )}
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
        </aside>
      </div>

      <section className="run-changes" aria-labelledby="diff-title">
        <div className="section-head">
          <h2 id="diff-title">Changes</h2>
          <span className="muted">Latest diff, all turns</span>
        </div>
        <DiffView diff={latestDiff ?? detail.latestDiff?.diff ?? null} />
      </section>
    </div>
  );
}
