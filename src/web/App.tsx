import { useEffect, useState, type MouseEvent } from "react";
import { api } from "./api";
import { HomeView } from "./HomeView";
import { parseRoute, pathFor, type Route } from "./route";
import { RunView } from "./RunView";

/** Client-side navigation: a same-origin link pushes a history entry; the server serves the app for any path. */
function go(path: string) {
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function linkTo(path: string) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(path);
  };
}

function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.hash);
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [showcase, setShowcase] = useState(false);

  useEffect(() => {
    api.health().then((h) => setShowcase(h.mode === "showcase")).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Old hash links become path links, so a shared URL keeps working.
    if (window.location.hash.startsWith("#/runs/")) {
      const next = pathFor(parseRoute("/", window.location.hash));
      window.history.replaceState(null, "", next);
    }
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  const openRun = (id: string) => go(`/runs/${id}`);
  const goHome = () => go("/");

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <a href="/" className="brand" onClick={linkTo("/")}>drydock</a>
        {showcase && (
          <span className="mode-chip" title="Replays of runs recorded against real Docker with a scripted model. Writes are refused.">
            Recorded runs, read only
          </span>
        )}
        <span className="topbar-note">Background coding agents, one sandbox per run</span>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        {route.name === "home" && <HomeView onOpen={openRun} showcase={showcase} linkTo={linkTo} />}
        {route.name === "run" && <RunView key={route.id} runId={route.id} onBack={goHome} showcase={showcase} linkTo={linkTo} />}
        {route.name === "missing" && (
          <section className="state not-found" aria-labelledby="nf-title">
            <h1 id="nf-title">No page at {route.path}</h1>
            <p>Run pages have the form <code>/runs/&lt;id&gt;</code>. Find a run in the <a href="/" onClick={linkTo("/")}>list of runs</a>.</p>
          </section>
        )}
      </main>
    </div>
  );
}
