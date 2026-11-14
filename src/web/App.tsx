import { useEffect, useState } from "react";
import { HomeView } from "./HomeView";
import { RunView } from "./RunView";

type Route = { name: "home" } | { name: "run"; id: string };

function parseHash(hash: string): Route {
  const match = /^#\/runs\/([a-f0-9]{6,32})$/.exec(hash);
  return match ? { name: "run", id: match[1]! } : { name: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

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
      <header className="topbar">
        <a href="#/" className="brand" onClick={goHome}>drydock</a>
        <span className="topbar-note">Background coding agents, one sandbox per run</span>
      </header>
      <main className="content">
        {route.name === "home" ? <HomeView onOpen={openRun} /> : <RunView key={route.id} runId={route.id} onBack={goHome} />}
      </main>
    </div>
  );
}
