// Vercel function for the hosted showcase. Serves the recorded seed only: no database, Docker or git.
// vercel.json rewrites /api/<path> and /git/<path> here with the original sub-path in `__path`.
import seedJson from "../showcase/seed.json" with { type: "json" };
import { createShowcaseApp, parseSeed } from "../src/server/showcase-app.js";

const app = createShowcaseApp(parseSeed(seedJson));

const handler = (request: Request) => {
  const url = new URL(request.url);
  const sub = url.searchParams.get("__path") ?? "";
  url.searchParams.delete("__path");
  url.pathname = `/api/${sub}`;
  return app.fetch(new Request(url, request));
};

// Web-standard method exports. Non-GET methods reach the app and are refused there with 403.
export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
