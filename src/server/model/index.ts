import type { Config } from "../config";
import { anthropicModel } from "./anthropic";
import { openAICompatibleModel } from "./openai";
import { scriptedModel, SCRIPTS } from "./scripted";
import type { ModelClient } from "./types";

/**
 * Picks the model provider from config. Returns a factory so every run gets a fresh
 * client (the scripted provider keeps a per-run cursor).
 */
export function createModelFactory(cfg: Config): () => ModelClient {
  switch (cfg.provider) {
    case "anthropic":
      return () => anthropicModel({ model: cfg.model });
    case "openai":
      if (!cfg.openai.baseUrl) throw new Error("DRYDOCK_OPENAI_BASE_URL is required for the openai provider");
      return () => openAICompatibleModel({ baseUrl: cfg.openai.baseUrl, apiKey: cfg.openai.apiKey, model: cfg.model });
    case "scripted": {
      const steps = SCRIPTS[cfg.scriptName];
      if (!steps) throw new Error(`unknown DRYDOCK_SCRIPT "${cfg.scriptName}"; known: ${Object.keys(SCRIPTS).join(", ")}`);
      return () => scriptedModel(steps);
    }
  }
}
