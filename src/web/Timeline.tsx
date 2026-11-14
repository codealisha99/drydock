import { testSummary, toolHeadline, type TimelineItem } from "./timeline-model";

const SHORT_OUTPUT_LINES = 10;

/** Elapsed run time as "4.2s" or "1m 04s". Replays show the recorded clock. */
export function elapsed(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function TestBadge({ output }: { output: string }) {
  const totals = testSummary(output);
  if (!totals) return null;
  const failing = totals.fail > 0;
  return (
    <span className={`test-badge ${failing ? "is-failing" : "is-passing"}`}>
      {failing ? `${totals.fail} failing` : "all passing"}
      <span className="test-count">{` · ${totals.pass} pass`}</span>
    </span>
  );
}

function Output({ text, isError, lines }: { text: string; isError: boolean; lines: number }) {
  return (
    <details className="output" open={lines <= SHORT_OUTPUT_LINES}>
      <summary>
        {lines} {lines === 1 ? "line" : "lines"} of output
        {isError && <span className="output-flag">failed</span>}
      </summary>
      <pre className={isError ? "output-error" : undefined}>{text || "(no output)"}</pre>
    </details>
  );
}

function Body({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "status":
      return <p className="status-line">{item.text}</p>;
    case "user":
      return (
        <div className="speaker-block is-you">
          <span className="speaker">You</span>
          <p>{item.text}</p>
        </div>
      );
    case "agent":
      return (
        <div className="speaker-block">
          <span className="speaker">Agent</span>
          <p>{item.text}</p>
        </div>
      );
    case "tool": {
      const lines = item.output === null ? 0 : item.output.split("\n").length;
      return (
        <div className={`tool-card ${item.isError ? "is-error" : ""}`}>
          <div className="tool-head">
            <span className="tool-name">{item.name}</span>
            {item.output !== null && <TestBadge output={item.output} />}
          </div>
          <code className="tool-input">{toolHeadline(item.name, item.input)}</code>
          {item.output !== null && <Output text={item.output} isError={item.isError} lines={lines} />}
        </div>
      );
    }
    case "delivery":
      return (
        <div className="delivery-block">
          <span className="speaker">Delivered</span>
          <p>
            Branch <code>{item.branch}</code> on {item.provider === "github" ? "GitHub" : "the local remote"}.
            {item.provider === "github" && (
              <>
                {" "}
                <a href={item.url} target="_blank" rel="noreferrer">Open pull request</a>
              </>
            )}
          </p>
        </div>
      );
    case "outcome":
      return (
        <div className="outcome-card">
          <span className="outcome-label">{item.status.replace("_", " ")}</span>
          <p>{item.summary}</p>
        </div>
      );
    case "error":
      return (
        <div className="error-block">
          <span className="speaker">Error</span>
          <p>{item.message}</p>
        </div>
      );
  }
}

/**
 * The run as a rail of steps. `streaming` marks the step in progress with a pulsing cursor row, so the
 * page reads as a working agent rather than a finished log.
 */
export function Timeline({ items, connected, streaming, emptyText }: { items: TimelineItem[]; connected: boolean; streaming: boolean; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="muted">{emptyText ?? (connected ? "Waiting for the first event." : "Connecting to the event stream.")}</p>;
  }
  const origin = items[0]!.at;
  return (
    <ol className="timeline" aria-label="Run events" aria-live="off">
      {items.map((item) => (
        <li key={`${item.kind}-${item.seq}`} className={`row row-${item.kind}`}>
          <time className="stamp" dateTime={item.at}>{elapsed(origin, item.at)}</time>
          <div className="row-body">
            <Body item={item} />
          </div>
        </li>
      ))}
      {streaming && (
        <li className="row row-live" aria-live="polite">
          <span className="stamp" aria-hidden="true" />
          <div className="row-body">
            <p className="live-line"><span className="live-dot" aria-hidden="true" />Agent is working<span className="caret" aria-hidden="true" /></p>
          </div>
        </li>
      )}
    </ol>
  );
}
