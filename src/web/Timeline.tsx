import { toolHeadline, testSummary, type TimelineItem } from "./timeline-model";

const SHORT_OUTPUT_LINES = 10;

/** Elapsed run time as "4.2s" or "1m 04s". Replays show the recorded clock, not "3s ago". */
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

function Row({ item, origin }: { item: TimelineItem; origin: string }) {
  const stamp = <span className="stamp">{elapsed(origin, item.at)}</span>;
  switch (item.kind) {
    case "status":
      return <li className="row row-status">{stamp}<span>{item.text}</span></li>;
    case "user":
      return (
        <li className="row row-user">
          {stamp}
          <span className="speaker">You</span>
          <p>{item.text}</p>
        </li>
      );
    case "agent":
      return (
        <li className="row row-agent">
          {stamp}
          <span className="speaker">Agent</span>
          <p>{item.text}</p>
        </li>
      );
    case "tool": {
      const lines = item.output === null ? 0 : item.output.split("\n").length;
      return (
        <li className={`row row-tool ${item.isError ? "is-error" : ""}`}>
          {stamp}
          <div className="tool-card">
            <div className="tool-head">
              <span className="tool-name">{item.name}</span>
              {item.output !== null && <TestBadge output={item.output} />}
            </div>
            <code className="tool-input">{toolHeadline(item.name, item.input)}</code>
            {item.output !== null && <Output text={item.output} isError={item.isError} lines={lines} />}
          </div>
        </li>
      );
    }
    case "delivery":
      return (
        <li className="row row-delivery">
          {stamp}
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
        </li>
      );
    case "outcome":
      return (
        <li className={`row row-outcome outcome-${item.status}`}>
          {stamp}
          <div className="outcome-card">
            <span className="outcome-label">{item.status.replace("_", " ")}</span>
            <p>{item.summary}</p>
          </div>
        </li>
      );
    case "error":
      return (
        <li className="row row-error">
          {stamp}
          <span className="speaker">Error</span>
          <p>{item.message}</p>
        </li>
      );
  }
}

export function Timeline({ items, connected, live }: { items: TimelineItem[]; connected: boolean; live: boolean }) {
  if (items.length === 0) {
    return <p className="muted">{connected ? "Waiting for the first event." : "Connecting to the event stream."}</p>;
  }
  const origin = items[0]!.at;
  return (
    <ol className="timeline" aria-label="Run events" aria-live={live ? "polite" : "off"}>
      {items.map((item) => (
        <Row key={`${item.kind}-${item.seq}`} item={item} origin={origin} />
      ))}
    </ol>
  );
}
