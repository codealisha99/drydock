import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { api, type Run } from "./api";
import { CommandLine } from "./CommandLine";
import { changesLine, durationLine, testsLine } from "./facts";
import { firstLine, formatRecorded, shortRepo } from "./format";
import { LOCAL_RUN_COMMAND } from "./local-run";
import { StatusMark } from "./StatusMark";

const EMPTY_FORM = { repo: "", branch: "main", instruction: "", delivery: "local" as const };
const POLL_MS = 2000;
type LinkTo = (path: string) => (e: MouseEvent) => void;

/** Runs that need a person: a question or a failure. First-class, above the ledger. */
function NeedsYou({ runs, linkTo }: { runs: Run[]; linkTo: LinkTo }) {
  if (runs.length === 0) return null;
  return (
    <section className="needs" aria-labelledby="needs-title">
      <h2 id="needs-title">Needs you <span className="count">{runs.length}</span></h2>
      <ul className="needs-list">
        {runs.map((run) => (
          <li key={run.id} className={`needs-item needs-${run.status}`}>
            <StatusMark status={run.status} />
            <a href={`/runs/${run.id}`} className="needs-title" onClick={linkTo(`/runs/${run.id}`)}>{firstLine(run.instruction)}</a>
            {run.summary && <p>{run.summary}</p>}
            <span className="needs-meta">{formatRecorded(run.createdAt)} · {shortRepo(run.repo)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Showcase mode: the form is replaced by one compact card that says what a local run needs. */
export function LocalRunCard() {
  return (
    <section className="local-card" aria-labelledby="local-title">
      <h2 id="local-title">Start runs locally</h2>
      <p>This copy replays recorded runs and cannot start new ones. A real run needs Docker on your machine.</p>
      <CommandLine command={LOCAL_RUN_COMMAND} />
      <p className="muted">Run <code>pnpm sandbox:build</code> once, then <code>pnpm web</code> and open 127.0.0.1:4101.</p>
    </section>
  );
}

function NewRunForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { run } = await api.createRun(form);
      setForm(EMPTY_FORM);
      onCreated(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-run" onSubmit={submit} aria-labelledby="new-run-title">
      <h2 id="new-run-title">New run</h2>
      <label>
        <span>Repository</span>
        <input required value={form.repo} onChange={set("repo")} placeholder="/path/to/bare.git or https://github.com/owner/repo" />
      </label>
      <div className="form-row">
        <label>
          <span>Base branch</span>
          <input required value={form.branch} onChange={set("branch")} />
        </label>
        <label>
          <span>Deliver to</span>
          <select value={form.delivery} onChange={set("delivery")}>
            <option value="local">Local bare remote</option>
            <option value="github">GitHub pull request</option>
          </select>
        </label>
      </div>
      <label>
        <span>Instruction</span>
        <textarea required rows={4} value={form.instruction} onChange={set("instruction")} placeholder="What should the agent change, and how will it know it is done?" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? "Starting…" : "Start run"}</button>
      </div>
    </form>
  );
}

/** One run per row, with facts a reader can scan. The title link covers the whole row. */
function Ledger({ runs, linkTo }: { runs: Run[]; linkTo: LinkTo }) {
  return (
    <ul className="ledger" aria-label="Runs, newest first">
      {runs.map((run) => {
        const tests = testsLine(run.facts);
        return (
          <li key={run.id} className="ledger-row">
            <div className="ledger-state">
              <StatusMark status={run.status} />
              <span className="ledger-date">{formatRecorded(run.createdAt)}</span>
            </div>
            <div className="ledger-main">
              <a href={`/runs/${run.id}`} className="ledger-title" onClick={linkTo(`/runs/${run.id}`)}>{firstLine(run.instruction)}</a>
              {run.summary && <p className="ledger-summary">{run.summary}</p>}
            </div>
            <dl className="ledger-facts">
              <div><dt>Duration</dt><dd>{durationLine(run.facts)}</dd></div>
              <div><dt>Steps</dt><dd>{run.facts.steps}</dd></div>
              <div><dt>Changes</dt><dd>{changesLine(run.facts)}</dd></div>
              <div><dt>Tests</dt><dd>{tests ?? "None run"}</dd></div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

export function HomeView({ onOpen, showcase, linkTo }: { onOpen: (id: string) => void; showcase: boolean; linkTo: LinkTo }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [inbox, setInbox] = useState<Run[]>([]);
  const [failing, setFailing] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [all, pending] = await Promise.all([api.listRuns(), api.inbox()]);
        if (!alive) return;
        setRuns(all.runs);
        setInbox(pending.runs);
        setFailing(false);
      } catch {
        if (alive) setFailing(true);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  let body;
  if (failing && runs === null) body = <p className="state state-error" role="alert">Cannot reach the drydock API. Retrying every few seconds.</p>;
  else if (runs === null) body = <p className="state muted" role="status">Loading runs…</p>;
  else if (runs.length === 0) body = <p className="state muted">No runs yet. Submit a task with the form. Each run gets its own sandbox.</p>;
  else body = <Ledger runs={runs} linkTo={linkTo} />;

  return (
    <div className="home">
      <div className="home-main">
        <header className="page-head">
          <h1>Runs</h1>
          {runs && <p className="muted">{runs.length} {showcase ? "recorded" : runs.length === 1 ? "run" : "runs"}</p>}
          {failing && runs !== null && <p className="form-error" role="alert">Lost the connection. Showing the last list.</p>}
        </header>
        <NeedsYou runs={inbox} linkTo={linkTo} />
        {body}
      </div>
      <aside className="home-side">
        {showcase ? <LocalRunCard /> : <NewRunForm onCreated={onOpen} />}
      </aside>
    </div>
  );
}
