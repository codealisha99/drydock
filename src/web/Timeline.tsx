import { useState } from "react";
import { toolHeadline, type TimelineItem } from "./timeline-model";
import { ago } from "./format";

const LONG_OUTPUT_LINES = 14;

function Output({ text, isError }: { text: string; isError: boolean }) {
  const lines = text.split("\n");
  const long = lines.length > LONG_OUTPUT_LINES;
  const [open, setOpen] = useState(!long);
  const shown = open ? text : lines.slice(0, LONG_OUTPUT_LINES).join("\n");
  return (
    <div className={`output ${isError ? "output-error" : ""}`}>
      <pre>{shown || "(no output)"}</pre>
      {long && (
        <button type="button" className="link-button" onClick={() => setOpen((v) => !v)}>
          {open ? "Collapse output" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function Row({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "status":
      return <li className="row row-status"><span className="stamp">{ago(item.at)}</span>{item.text}</li>;
    case "user":
      return (
        <li className="row row-user">
          <span className="speaker">You</span>
          <p>{item.text}</p>
        </li>
      );
    case "agent":
      return (
        <li className="row row-agent">
          <span className="speaker">Agent</span>
          <p>{item.text}</p>
        </li>
      );
    case "tool":
      return (
        <li className={`row row-tool ${item.isError ? "is-error" : ""}`}>
          <div className="tool-head">
            <span className="tool-name">{item.name}</span>
            <code className="tool-input">{toolHeadline(item.name, item.input)}</code>
          </div>
          {item.output !== null && <Output text={item.output} isError={item.isError} />}
        </li>
      );
    case "delivery":
      return (
        <li className="row row-delivery">
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
          <span className="speaker">Result</span>
          <p>
            <strong>{item.status.replace("_", " ")}</strong>. {item.summary}
          </p>
        </li>
      );
    case "error":
      return (
        <li className="row row-error">
          <span className="speaker">Error</span>
          <p>{item.message}</p>
        </li>
      );
  }
}

export function Timeline({ items, connected }: { items: TimelineItem[]; connected: boolean }) {
  if (items.length === 0) {
    return <p className="muted">{connected ? "Waiting for the first event." : "Connecting to the event stream."}</p>;
  }
  return (
    <ol className="timeline" aria-label="Run events" aria-live="polite">
      {items.map((item) => (
        <Row key={`${item.kind}-${item.seq}`} item={item} />
      ))}
    </ol>
  );
}
