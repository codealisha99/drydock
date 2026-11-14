// Routing middleware for the hosted showcase. Refuses every non-GET/HEAD request on every path,
// including static assets, before anything else runs. Imports nothing.
export const config = { matcher: "/:path*" };

const SHOWCASE_MESSAGE = "showcase mode: run it locally to start real runs";

export default function middleware(request: Request): Response | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return new Response(JSON.stringify({ error: SHOWCASE_MESSAGE }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}
