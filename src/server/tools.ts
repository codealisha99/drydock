import { z } from "zod";
import type { Sandbox } from "./sandbox";
import type { ToolSpec } from "./model/types";
import { resolveWorkspacePath } from "./workspace";

export const MAX_TOOL_OUTPUT = 16_000;
const COMMAND_TIMEOUT_MS = 120_000;

const ReadInput = z.object({ path: z.string() }).strict();
const WriteInput = z.object({ path: z.string(), content: z.string().max(512_000) }).strict();
const EditInput = z
  .object({ path: z.string(), old_string: z.string().min(1), new_string: z.string() })
  .strict();
const BashInput = z.object({ command: z.string().min(1).max(8_000), timeout_ms: z.number().int().positive().max(COMMAND_TIMEOUT_MS).optional() }).strict();
export const FinishInput = z
  .object({
    status: z.enum(["succeeded", "needs_input", "failed"]),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), "summary must be one line"),
  })
  .strict();
export type Outcome = z.infer<typeof FinishInput>;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file in the repository. Path is relative to the repo root.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the repository (parent directories are created).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description: "Replace exactly one occurrence of old_string with new_string in a file. Fails if old_string is not unique.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
  {
    name: "bash",
    description: "Run a shell command in the repository root inside the sandbox (tests, git, package managers). No network secrets are available.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" }, timeout_ms: { type: "integer" } },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description:
      "Call exactly once when done. status: succeeded (work complete and verified), needs_input (a human decision is required), failed (cannot complete). summary: one line.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["succeeded", "needs_input", "failed"] }, summary: { type: "string" } },
      required: ["status", "summary"],
      additionalProperties: false,
    },
  },
];

export interface ToolResult {
  content: string;
  isError: boolean;
}

const clip = (s: string): string =>
  s.length <= MAX_TOOL_OUTPUT ? s : `${s.slice(0, MAX_TOOL_OUTPUT)}\n...[truncated ${s.length - MAX_TOOL_OUTPUT} chars]`;

const fail = (content: string): ToolResult => ({ content, isError: true });

function parseOrFail<T>(schema: z.ZodType<T>, input: unknown): { ok: true; value: T } | { ok: false; error: ToolResult } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: fail(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`) };
}

async function readFile(sb: Sandbox, rawPath: string, signal?: AbortSignal): Promise<ToolResult> {
  const target = resolveWorkspacePath(rawPath, sb.workspace);
  const res = await sb.exec('cat -- "$1"', [target], { signal, maxBytes: MAX_TOOL_OUTPUT * 4 });
  if (res.code !== 0) return fail(res.stderr.trim() || `cannot read ${rawPath}`);
  return { content: clip(res.stdout), isError: false };
}

async function writeFile(sb: Sandbox, rawPath: string, content: string, signal?: AbortSignal): Promise<ToolResult> {
  const target = resolveWorkspacePath(rawPath, sb.workspace);
  const res = await sb.exec('mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', [target], { input: content, signal });
  if (res.code !== 0) return fail(res.stderr.trim() || `cannot write ${rawPath}`);
  return { content: `wrote ${content.length} chars to ${rawPath}`, isError: false };
}

/** Exact-once replacement, done on the host from a sandbox read so the model never writes raw shell. */
async function editFile(sb: Sandbox, input: z.infer<typeof EditInput>, signal?: AbortSignal): Promise<ToolResult> {
  const original = await sb.exec('cat -- "$1"', [resolveWorkspacePath(input.path, sb.workspace)], { signal, maxBytes: 4 * MAX_TOOL_OUTPUT * 4 });
  if (original.code !== 0) return fail(original.stderr.trim() || `cannot read ${input.path}`);
  const occurrences = original.stdout.split(input.old_string).length - 1;
  if (occurrences !== 1) return fail(`old_string must occur exactly once in ${input.path}; found ${occurrences}`);
  const updated = original.stdout.replace(input.old_string, () => input.new_string);
  return writeFile(sb, input.path, updated, signal);
}

async function bash(sb: Sandbox, input: z.infer<typeof BashInput>, signal?: AbortSignal): Promise<ToolResult> {
  const res = await sb.exec(input.command, [], { signal, timeoutMs: input.timeout_ms ?? COMMAND_TIMEOUT_MS });
  if (res.timedOut) return fail(`command timed out\n${clip(res.stdout + res.stderr)}`);
  const body = `${res.stdout}${res.stderr ? `\n[stderr]\n${res.stderr}` : ""}\n[exit ${res.code}]`;
  return { content: clip(body.trim()), isError: res.code !== 0 };
}

/** Executes one non-finish tool call inside the sandbox. Errors become tool results, never thrown. */
export async function runSandboxTool(sb: Sandbox, name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult> {
  try {
    switch (name) {
      case "read_file": {
        const p = parseOrFail(ReadInput, input);
        return p.ok ? await readFile(sb, p.value.path, signal) : p.error;
      }
      case "write_file": {
        const p = parseOrFail(WriteInput, input);
        return p.ok ? await writeFile(sb, p.value.path, p.value.content, signal) : p.error;
      }
      case "edit_file": {
        const p = parseOrFail(EditInput, input);
        return p.ok ? await editFile(sb, p.value, signal) : p.error;
      }
      case "bash": {
        const p = parseOrFail(BashInput, input);
        return p.ok ? await bash(sb, p.value, signal) : p.error;
      }
      default:
        return fail(`unknown tool "${name}"`);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    return fail(err instanceof Error ? err.message : String(err));
  }
}
