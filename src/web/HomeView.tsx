import { useEffect, useState, type FormEvent } from "react";
import { api, type Run } from "./api";
import { ago, firstLine, shortRepo } from "./format";
import { StatusMark } from "./StatusMark";

const EMPTY_FORM = { repo: "", branch: "main", instruction: "", delivery: "local" as const };
const POLL_MS = 2000;

function Inbox({ runs }: { runs: Run[] }) {
  return (
    <section className="panel" aria-labelledby="inbox-title">
      <h2 id="inbox-title">Needs you</h2>
      {runs.length === 0 ? (
        <p className="muted">Nothing is waiting. Runs that need a decision or fail show up here.</p>
      ) : (
        <ul className="inbox">
          {runs.map((run) => (
            <li key={run.id} className={`inbox-item inbox-${run.status}`}>
              <StatusMark status={run.status} />
              <a href={`#/runs/${run.id}`} className="inbox-title">{firstLine(run.instruction, 80)}</a>
              <p>{run.summary}</p>
            </li>
          ))}
        </ul>
      )}
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
    setBusy(true);
    setError(null);
    try {
      const { run } = await api.createRun(form);
      setForm(EMPTY_FORM);
      onCreated(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start the run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>New run</h2>
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

function Ledger({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return <p className="muted">No runs yet. Start one with the form.</p>;
  return (
    <table className="ledger">
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
            <td>
              <a href={`#/runs/${run.id}`} className="ledger-task">{firstLine(run.instruction)}</a>
              {run.summary && <span className="ledger-summary">{run.summary}</span>}
            </td>
            <td className="mono">{shortRepo(run.repo)} <span className="muted">{run.baseBranch}</span></td>
            <td className="mono muted">{ago(run.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HomeView({ onOpen }: { onOpen: (id: string) => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [inbox, setInbox] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [all, pending] = await Promise.all([api.listRuns(), api.inbox()]);
        if (!alive) return;
        setRuns(all.runs);
        setInbox(pending.runs);
        setLoaded(true);
      } catch {
        // keep the last good data; the next poll retries
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="home">
      <div className="home-main">
        <header className="page-head">
          <h1>Runs</h1>
          <p className="muted">{loaded ? `${runs.length} recorded` : "Loading"}</p>
        </header>
        <Ledger runs={runs} />
      </div>
      <aside className="home-side">
        <NewRunForm onCreated={onOpen} />
        <Inbox runs={inbox} />
      </aside>
    </div>
  );
}
