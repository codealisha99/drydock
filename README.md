# drydock

A cloud coding-agent platform: submit a task against a repo, and an agent works on it inside its own
Docker sandbox, streams every step to a live timeline, and delivers the result as a branch and a pull
request. Think small Devin / Codex cloud / Cursor background agents. The agent loop runs on the host and
drives the container with `docker exec`, so no API keys ever enter a sandbox.

The hard part is the boundary. Agent-issued commands run in a container with no capabilities, a read-only
root, memory, CPU and PID caps, and no host mounts. The model's credentials and the GitHub token stay on
the host. Git moves through the one narrow channel that exists: the sandbox clones over HTTP from the
host, and the host applies the sandbox's patches to a fresh clone and pushes. Runs are durable (SQLite),
queued with a concurrency cap, recoverable after a restart, and only the runs that need a human appear in
the inbox.

```mermaid
flowchart LR
  UI[Web UI :4101] -- REST + SSE --> API[API :4100]
  API --> Q[Run queue<br/>concurrency cap]
  Q --> W[Worker]
  W --> AG[Agent loop<br/>model + tools]
  AG -- docker exec --> SB[(Sandbox container<br/>no caps, ro root,<br/>tmpfs /work)]
  SB -- git clone over HTTP --> GH[/git route<br/>read-only]
  W -- patches, push, PR --> DL[Delivery<br/>local bare remote or GitHub]
  API --- DB[(SQLite<br/>runs, events, PRs)]
  AG -- Anthropic SDK / OpenAI-compatible --> LLM[(Model)]
```

## Quickstart

Requirements: Node 25 (or 22.13+), pnpm 10, Docker.

```bash
pnpm install
pnpm sandbox:build          # builds drydock-sandbox:latest (node:22-alpine + git, non-root)
pnpm demo                   # keyless end-to-end run (starts the API, runs and tears down)
```

`pnpm demo` seeds a bare repo with a failing test, submits a task over HTTP, follows the SSE timeline while
a scripted agent fixes `add()` inside a container, checks the tests pass in the sandbox, verifies the branch
on the bare remote and the PR record, then stops the server. Set `DEMO_KEEP=1 pnpm demo` to leave the API up,
then run `pnpm web` and open http://127.0.0.1:4101/ to see the run page.

Real model (needs a key):

```bash
cp .env.example .env        # set ANTHROPIC_API_KEY, and GITHUB_TOKEN for GitHub delivery
pnpm api                    # API on :4100
pnpm web                    # UI on :4101 (proxies /api and /git to :4100)
```

Default model is `claude-sonnet-5-5`, overridable with `DRYDOCK_MODEL`. `DRYDOCK_MODEL_PROVIDER=openai`
with `DRYDOCK_OPENAI_BASE_URL` targets any OpenAI-compatible endpoint (Ollama, OpenRouter, Groq).

Tests:

```bash
pnpm test                   # unit tests, hermetic, no Docker
pnpm test:integration       # real Docker sandbox (needs drydock-sandbox:latest)
pnpm typecheck
```

Submitting a run:

```bash
curl -s localhost:4100/api/runs -H 'content-type: application/json' -d '{
  "repo": "/absolute/path/to/bare.git",   # or https://github.com/owner/repo with delivery "github"
  "branch": "main",
  "instruction": "Fix the failing test in src/math.js",
  "delivery": "local"
}'
```

## Design decisions and trade-offs

- **Agent loop on the host, tools in the sandbox.** Each tool call is a `docker exec`. Credentials never
  enter the container, and the loop can be cancelled mid-command by killing the exec. The cost is one
  `docker exec` per tool call, which is fine at agent speed.
- **Hardened container, not a VM.** `--cap-drop ALL`, `no-new-privileges`, `--read-only` with a tmpfs
  workspace, 1 GB memory, 1 CPU, 256 PIDs, uid 1000, no mounts. The integration test inspects these
  flags on a live container. Trade-off: a kernel exploit still escapes a container; this is not a
  multi-tenant security boundary.
- **Git without credentials in the sandbox.** The sandbox clones from a read-only smart-HTTP route on the
  host. Pushes are refused on that route. The host clones the target fresh, runs `git am` on the sandbox's
  `format-patch` output, and pushes. The GitHub token goes through git's env config, so it never appears in
  argv. The result is that a compromised sandbox cannot push anywhere.
- **One delivery function, two targets.** `deliverBranch` handles a local bare remote (push plus a PR row
  with the diff) and GitHub (push plus `POST /repos/{o}/{r}/pulls`). Follow-up turns push only new commits
  to the same branch and do not open a second PR.
- **Durable runs.** Runs, events and PRs live in SQLite. Every event gets a sequence number, and the SSE
  endpoint replays from `?after=` and then streams live, so a reconnect loses nothing. The subscription is
  registered before the replay, so no event falls between the two.
- **Boot recovery is explicit.** On start, queued and running runs become `failed` ("server restarted"),
  and every container labelled `drydock.managed=true` is removed. Finished runs keep their row but lose
  the sandbox pointer, and a follow-up on them returns a clear 409. Idle sandboxes are swept after
  `DRYDOCK_IDLE_TTL_MS`.
- **Async outcome, not a stream of chatter.** The agent ends every turn with `finish(status, summary)`:
  `succeeded`, `needs_input`, or `failed`, with a one-line summary validated at the boundary. The inbox
  lists only `needs_input` and `failed`. A turn that finishes with no file changes is reported as
  `needs_input` rather than silently "succeeded".
- **Boundary validation.** Repo inputs are resolved (https URL or absolute bare-repo path), branch names
  are regex-checked, model-supplied paths are confined to `/work`, and tool inputs are zod-validated with
  invalid input returned to the model as an error result. POST bodies must be `application/json`, which
  blocks cross-site form posts because the server sends no CORS headers.
- **Deterministic model for tests and the demo.** The scripted provider replays a fixed sequence, so the
  demo is keyless and the loop is testable. Unit tests run the whole pipeline (real git over real HTTP,
  real commits, real delivery) against host directories standing in for containers; the integration test
  swaps in real Docker.

## Verification

Run on macOS arm64 with Docker Desktop, from a clean `pnpm install --frozen-lockfile`:

- `pnpm test`: 9 files, 48 tests pass (path guard, tools, agent loop, queue, recovery and sweep, git
  delivery, git HTTP, pipeline with a cancel, a follow-up and SSE replay, timeline model).
- `pnpm test:integration`: 3 tests pass against real containers (hardened flags and no secrets inside,
  full run with a pushed branch and PR record, managed containers removed on shutdown).
- `pnpm typecheck` and `pnpm build` pass.
- `pnpm demo`: passes. The agent fixes `add()` in the container; the tests go from `fail 1` to `fail 0`;
  the branch is on the bare remote and `main` is unchanged; one PR record with the diff; no managed
  containers remain after shutdown.
- UI checked in headless Chrome: the home page with the ledger, form and inbox; the run page with the
  timeline, tool cards, collapsed long output, diff and delivery link; the needs-input run with its
  inbox entry and follow-up form. No console errors.

Not verified: the live Anthropic path (no API key on this machine, so the default provider is untested
end to end), the GitHub delivery path against the real API (covered only by a fake `fetch` test), and
private GitHub repos (the sandbox clones unauthenticated).

## Limitations and next steps

- Local-path repos are published by symlinking them into the served directory and are then readable by
  anything that can reach `127.0.0.1:4100`. Fine for a single-user dev box, not for a shared host.
- Containers keep a normal bridge network so they can reach the internet and the host's git route. A
  per-run network with an egress allow-list would close this.
- Private GitHub repos need the token inside the clone step. Next step: have the host mint a short-lived
  read-only clone bundle instead of giving the sandbox network access to GitHub.
- Only the first run of a repo clones from scratch. Caching a warm base image with dependencies per repo
  would cut startup time.
- The agent has no per-tool approval gate; it is one loop with one budget (`DRYDOCK_MAX_STEPS`). Human
  review happens in the PR, not in the loop.
- Single process, in-memory queue rebuilt from SQLite on boot. Fine for one host; multi-host needs a real
  job queue.
- `node:sqlite` is still flagged experimental in Node 25; the server prints a warning and the API works.
