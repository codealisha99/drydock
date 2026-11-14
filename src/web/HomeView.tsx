import { useEffect, useState, type FormEvent } from "react";
import { api, type Run } from "./api";
import { CommandLine } from "./CommandLine";
import { ago, firstLine, shortRepo } from "./format";
import { LOCAL_RUN_COMMAND } from "./local-run";
import { StatusMark } from "./StatusMark";

const EMPTY_FORM = { repo: "", branch: "main", instruction: "", delivery: "local" as const };
const POLL_MS = 2000;
const WHY_ID = "showcase-why";

/** Shown in showcase mode: what the refused controls would do here, and how to run them for real. */
export function ShowcaseExplainer() {
  return (
    <div className="explainer" id={WHY_ID}>
      <p>
        This copy replays recorded runs and cannot start new ones. A real run needs Docker and a model on your machine.
        Build the sandbox image once with <code>pnpm sandbox:build</code>, then start the API with a keyless scripted agent:
      </p>
      <CommandLine command={LOCAL_RUN_COMMAND} />
      <p>Open the UI in a second terminal with <code>pnpm web</code>, then submit a task at 127.0.0.1:4101.</p>
    </div>
  );
}

function Inbox({ runs }: { runs: Run[] }) {
  return (
    <section className="side-block" aria-labelledby="inbox-title">
      <h2 id="inbox-title">Needs you {runs.length > 0 && <span className="count">{runs.length}</span>}</h2>
      {runs.length === 0 ? (
        <p className="muted">Nothing needs you. Runs that ask a question or fail show up here.</p>
      ) : (
        <ul className="inbox">
          {runs.map((run) => (
            <li key={run.id} className={`inbox-item inbox-${run.status}`}>
              <StatusMark status={run.status} />
              <a href={`#/runs/${run.id}`} className="inbox-title">{firstLine(run.instruction, 80)}</a>
              {run.summary && <p>{run.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewRunForm({ onCreated, showcase }: { onCreated: (id: string) => void; showcase: boolean }) {
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
    <form className="side-block form" onSubmit={submit} aria-labelledby="new-run-title">
      <h2 id="new-run-title">New run</h2>
      {showcase && <ShowcaseExplainer />}
      <fieldset className="form-fields" disabled={showcase} aria-describedby={showcase ? WHY_ID : undefined}>
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
          <button type="submit" className="primary" disabled={busy || showcase}>{busy ? "Starting…" : "Start run"}</button>
        </div>
      </fieldset>
    </form>
  );
}

function Ledger({ runs }: { runs: Run[] }) {
  return (
    <table className="ledger">
      <caption className="sr-only">Runs, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Task</th>
          <th scope="col">Repository</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td><StatusMark status={run.status} /></td>
            <td className="task-cell">
              <a href={`#/runs/${run.id}`} className="ledger-task">{firstLine(run.instruction)}</a>
              {run.summary && <span className="ledger-summary">{run.summary}</span>}
            </td>
            <td className="repo-cell">{shortRepo(run.repo)} <span className="muted">{run.baseBranch}</span></td>
            <td className="time-cell muted">{ago(run.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HomeView({ onOpen, showcase }: { onOpen: (id: string) => void; showcase: boolean }) {
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
  else body = <Ledger runs={runs} />;

  return (
    <div className="home">
      <div className="home-main">
        <header className="page-head">
          <h1>Runs</h1>
          {runs && <p className="muted">{runs.length} {showcase ? "recorded" : runs.length === 1 ? "run" : "runs"}</p>}
          {failing && runs !== null && <p className="form-error" role="alert">Lost the connection. Showing the last list.</p>}
        </header>
        {body}
      </div>
      <aside className="home-side">
        <NewRunForm onCreated={onOpen} showcase={showcase} />
        <Inbox runs={inbox} />
      </aside>
    </div>
  );
}
