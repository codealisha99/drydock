import { describe, expect, it } from "vitest";
import { cgiToResponse } from "../src/server/git/http";
import { serveGitHttp } from "../src/server/git/http";

describe("cgiToResponse", () => {
  it("parses CGI headers, Status line and body", async () => {
    const raw = Buffer.from("Status: 404 Not Found\r\nContent-Type: text/plain\r\n\r\nno such repo");
    const res = cgiToResponse(raw);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("no such repo");
  });

  it("accepts LF-only header separators", async () => {
    const res = cgiToResponse(Buffer.from("Content-Type: text/plain\n\nhello"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });
});

describe("serveGitHttp", () => {
  it("refuses pushes over HTTP", async () => {
    const res = await serveGitHttp(
      new Request("http://127.0.0.1/git/x.git/git-receive-pack", { method: "POST" }),
      "/tmp",
    );
    expect(res.status).toBe(403);
  });

  it("refuses path traversal", async () => {
    const res = await serveGitHttp(new Request("http://127.0.0.1/git/x.git/..%2F..%2Fetc/info/refs"), "/tmp");
    expect(res.status).toBe(400);
  });
});
