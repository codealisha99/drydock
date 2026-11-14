import { spawn } from "node:child_process";

/**
 * Serves repos under `root` over git smart-HTTP via `git http-backend` (read-only: pushes are
 * refused). This is how a sandbox clones a local repo without any host bind mount.
 */
export async function serveGitHttp(req: Request, root: string): Promise<Response> {
  const url = new URL(req.url);
  const repoPath = url.pathname.replace(/^\/git/, "");
  if (repoPath.includes("..") || repoPath.includes("\0")) return new Response("bad path", { status: 400 });
  if (repoPath.includes("git-receive-pack") || url.searchParams.get("service") === "git-receive-pack") {
    return new Response("pushes are not served over HTTP", { status: 403 });
  }
  const body = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await req.arrayBuffer());
  const env: NodeJS.ProcessEnv = {
    GIT_PROJECT_ROOT: root,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: repoPath,
    REQUEST_METHOD: req.method,
    QUERY_STRING: url.search.slice(1),
    CONTENT_TYPE: req.headers.get("content-type") ?? "",
    CONTENT_LENGTH: String(body.length),
    REMOTE_USER: "",
    GIT_PROTOCOL: req.headers.get("git-protocol") ?? "",
  };
  const cgi = await runCgi(env, body);
  return cgiToResponse(cgi);
}

function runCgi(env: NodeJS.ProcessEnv, body: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["http-backend"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks)));
    child.stdin.end(body);
  });
}

/** Splits CGI output into status/headers and body. Exported for tests. */
export function cgiToResponse(raw: Buffer): Response {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  const useCrlf = crlf !== -1 && (lf === -1 || crlf < lf);
  const end = useCrlf ? crlf : lf;
  if (end === -1) return new Response("bad gateway from git backend", { status: 502 });
  const headerText = raw.subarray(0, end).toString("utf8");
  const payload = raw.subarray(end + (useCrlf ? 4 : 2));
  const headers = new Headers();
  let status = 200;
  for (const line of headerText.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.toLowerCase() === "status") status = Number.parseInt(value, 10) || 200;
    else headers.append(key, value);
  }
  return new Response(new Uint8Array(payload), { status, headers });
}
