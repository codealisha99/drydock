export type Route = { name: "home" } | { name: "run"; id: string } | { name: "missing"; path: string };

/**
 * Maps a URL to a screen. Run pages live at /runs/<id>. Old hash links (#/runs/<id>) are still
 * understood, and the caller rewrites them to the path form. Pure.
 */
export function parseRoute(pathname: string, hash = ""): Route {
  const legacy = /^#\/runs\/([a-f0-9]{6,32})$/.exec(hash);
  if (pathname === "/" || pathname === "") return legacy ? { name: "run", id: legacy[1]! } : { name: "home" };
  // Any id is routed to the run page, which says whether the run exists.
  const run = /^\/runs\/([^/]+)\/?$/.exec(pathname);
  if (run) return { name: "run", id: run[1]! };
  return { name: "missing", path: pathname };
}

/** The canonical path for a route, used for links and for rewriting legacy hash URLs. */
export function pathFor(route: Route): string {
  if (route.name === "run") return `/runs/${route.id}`;
  return "/";
}
