import { useEffect, useState } from "react";
import { api } from "./api";
import { HomeView } from "./HomeView";
import { RunView } from "./RunView";

type Route = { name: "home" } | { name: "run"; id: string };

function parseHash(hash: string): Route {
  const match = /^#\/runs\/([a-f0-9]{6,32})$/.exec(hash);
  return match ? { name: "run", id: match[1]! } : { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [showcase, setShowcase] = useState(false);

  useEffect(() => {
    api.health().then((h) => setShowcase(h.mode === "showcase")).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openRun = (id: string) => {
    window.location.hash = `#/runs/${id}`;
  };
  const goHome = () => {
    window.location.hash = "#/";
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <a href="#/" className="brand" onClick={goHome}>drydock</a>
        {showcase && (
          <span className="mode-chip" title="Replays of runs recorded against real Docker with a scripted model. Writes are refused.">
            Recorded runs, read only
          </span>
        )}
        <span className="topbar-note">Background coding agents, one sandbox per run</span>
      </header>
      <main id="main" className="content" tabIndex={-1}>
        {route.name === "home" ? <HomeView onOpen={openRun} showcase={showcase} /> : <RunView key={route.id} runId={route.id} onBack={goHome} showcase={showcase} />}
      </main>
    </div>
  );
}
