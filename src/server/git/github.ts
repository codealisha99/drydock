export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const GITHUB_REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/** Parses https://github.com/owner/repo(.git) into its parts; null for anything else. */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = GITHUB_REPO_RE.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function openGithubPullRequest(opts: {
  owner: string;
  repo: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}): Promise<{ url: string; number: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = opts.apiBase ?? "https://api.github.com";
  const res = await fetchImpl(`${apiBase}/repos/${opts.owner}/${opts.repo}/pulls`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${opts.token}`,
      "user-agent": "drydock",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: opts.title, head: opts.head, base: opts.base, body: opts.body }),
  });
  if (!res.ok) throw new Error(`GitHub PR creation failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { html_url?: unknown; number?: unknown };
  if (typeof json.html_url !== "string" || typeof json.number !== "number") throw new Error("GitHub returned an unexpected PR payload");
  return { url: json.html_url, number: json.number };
}
