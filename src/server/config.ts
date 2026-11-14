import path from "node:path";

export type ModelProvider = "anthropic" | "openai" | "scripted";

export interface Config {
  port: number;
  dataDir: string;
  remotesDir: string;
  dbPath: string;
  sandboxImage: string;
  sandboxApiUrl: string;
  concurrency: number;
  maxSteps: number;
  idleTtlMs: number;
  provider: ModelProvider;
  model: string;
  scriptName: string;
  openai: { baseUrl: string; apiKey: string | undefined };
  githubToken: string | undefined;
}

const PROVIDERS: readonly ModelProvider[] = ["anthropic", "openai", "scripted"];

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DRYDOCK_DATA_DIR ?? "./data");
  const provider = (env.DRYDOCK_MODEL_PROVIDER ?? "anthropic") as ModelProvider;
  if (!PROVIDERS.includes(provider)) throw new Error(`DRYDOCK_MODEL_PROVIDER must be one of ${PROVIDERS.join(", ")}`);
  return {
    port: intEnv(env, "DRYDOCK_PORT", 4100),
    dataDir,
    remotesDir: path.join(dataDir, "remotes"),
    dbPath: path.join(dataDir, "drydock.sqlite"),
    sandboxImage: env.DRYDOCK_SANDBOX_IMAGE ?? "drydock-sandbox:latest",
    sandboxApiUrl: env.DRYDOCK_SANDBOX_API_URL ?? "http://host.docker.internal:4100",
    concurrency: intEnv(env, "DRYDOCK_CONCURRENCY", 2),
    maxSteps: intEnv(env, "DRYDOCK_MAX_STEPS", 40),
    idleTtlMs: intEnv(env, "DRYDOCK_IDLE_TTL_MS", 15 * 60 * 1000),
    provider,
    model: env.DRYDOCK_MODEL ?? "claude-sonnet-5-5",
    scriptName: env.DRYDOCK_SCRIPT ?? "fix-failing-test",
    openai: { baseUrl: env.DRYDOCK_OPENAI_BASE_URL ?? "", apiKey: env.DRYDOCK_OPENAI_API_KEY || undefined },
    githubToken: env.GITHUB_TOKEN || undefined,
  };
}
