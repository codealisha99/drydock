import { serve, type ServerType } from "@hono/node-server";

type Handler = (req: Request) => Response | Promise<Response>;

/**
 * Listens on an ephemeral port. The handler can be set after the port is known.
 * Defaults to loopback; pass "0.0.0.0" when containers must reach it (Linux maps host.docker.internal to the
 * docker bridge, which cannot reach a loopback-only socket).
 */
export function listenEphemeral(hostname = "127.0.0.1"): Promise<{ port: number; setHandler(h: Handler): void; close(): Promise<void> }> {
  let handler: Handler | null = null;
  return new Promise((resolve) => {
    const server: ServerType = serve(
      { port: 0, hostname, fetch: (req: Request) => (handler ? handler(req) : new Response("not ready", { status: 503 })) },
      (info) => {
        resolve({
          port: info.port,
          setHandler(h) {
            handler = h;
          },
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      },
    );
  });
}

export async function waitFor<T>(read: () => T | undefined | null | false, timeoutMs = 60_000, intervalMs = 50): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
