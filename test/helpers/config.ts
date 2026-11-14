import { loadConfig, type Config } from "../../src/server/config";

/** Real config loader with test-friendly env: scripted model, temp data dir, served on the given port. */
export function testConfig(dataDir: string, port: number, extra: Record<string, string> = {}): Config {
  return loadConfig({
    DRYDOCK_DATA_DIR: dataDir,
    DRYDOCK_SANDBOX_API_URL: `http://127.0.0.1:${port}`,
    DRYDOCK_MODEL_PROVIDER: "scripted",
    DRYDOCK_SCRIPT: "fix-failing-test",
    DRYDOCK_CONCURRENCY: "2",
    DRYDOCK_MAX_STEPS: "20",
    GITHUB_TOKEN: "",
    ...extra,
  });
}
