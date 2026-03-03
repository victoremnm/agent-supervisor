// src/supervisor/daemon.ts
// Supervisor daemon — Gemini Flash edition.
// Triggered by: GitHub Actions cron (every hour) or PR event hook.
// Model: gemini-2.0-flash (free tier via aistudio.google.com)

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclaration } from "@google/generative-ai";
import { exec } from "child_process";
import { promisify } from "util";
import { SYSTEM_PROMPT, buildSweepPrompt, buildPRPrompt } from "./agents.js";
import { bootstrapGitHubToken } from "../github/app.js";
import { createTrace, flushTraces } from "../observability/langfuse.js";

const execAsync = promisify(exec);

// Parse CLI args: --pr <number> for targeted PR review
const args = process.argv.slice(2);
const prFlagIndex = args.indexOf("--pr");
const targetPR: number | null =
  prFlagIndex !== -1 && args[prFlagIndex + 1]
    ? parseInt(args[prFlagIndex + 1], 10)
    : null;

// Target repos from env var (comma-separated: "owner/repo1,owner/repo2")
const TARGET_REPOS = (process.env.TARGET_REPOS ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

if (TARGET_REPOS.length === 0) {
  console.error("[daemon] ERROR: TARGET_REPOS env var is not set or empty.");
  process.exit(1);
}

// ─── Bash tool ────────────────────────────────────────────────────────────────

const BASH_TOOL: FunctionDeclaration = {
  name: "bash",
  description:
    "Execute a shell command and return stdout/stderr. " +
    "Use for gh pr list, gh pr diff, gh pr review, gh pr edit, jq, etc.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      command: {
        type: SchemaType.STRING,
        description: "The shell command to execute",
      },
    },
    required: ["command"],
  },
};

const MAX_OUTPUT_CHARS = 100_000; // Truncate runaway diffs

async function runBash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60_000,
      maxBuffer: MAX_OUTPUT_CHARS * 4,
    });
    const combined = (stdout + (stderr ? `\nSTDERR: ${stderr}` : "")).trim();
    return combined.length > MAX_OUTPUT_CHARS
      ? combined.slice(0, MAX_OUTPUT_CHARS) + "\n[output truncated]"
      : combined;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = ((e.stdout ?? "") + (e.stderr ?? "")) || (e.message ?? String(err));
    return `[non-zero exit] ${out.slice(0, 4_000)}`;
  }
}

// ─── Gemini agent loop ─────────────────────────────────────────────────────────

// Model is configurable — override with GEMINI_MODEL env var.
// Defaults to gemini-2.0-flash; fall back to gemini-1.5-flash if quota issues arise.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

/** Sleep for ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a Gemini call on 429 quota errors using the API-suggested retry delay. */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("RESOURCE_EXHAUSTED");
      if (!is429 || attempt === maxRetries) throw err;

      // Parse retry delay from the API response if present (e.g. "retry in 43s")
      const retryMatch = msg.match(/retry in (\d+)s/i) ?? msg.match(/"retryDelay":"(\d+)s"/);
      const delaySec = retryMatch ? parseInt(retryMatch[1], 10) : 15 * (attempt + 1);
      console.warn(`[gemini] 429 quota — retrying in ${delaySec}s (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(delaySec * 1000);
    }
  }
  throw new Error("withRetry: unreachable");
}

async function runAgent(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  console.log(`[gemini] Using model: ${GEMINI_MODEL}`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [BASH_TOOL] }],
  });

  const chat = model.startChat();
  let response = await withRetry(() => chat.sendMessage(prompt));

  // Tool-calling loop — runs until Gemini produces a plain text response
  for (let turn = 0; turn < 50; turn++) {
    const calls = response.response.functionCalls();
    if (!calls || calls.length === 0) break;

    // Execute all tool calls (may be batched by Gemini)
    const toolResults = await Promise.all(
      calls.map(async (call) => {
        const cmdArgs = call.args as { command?: string };
        const output =
          call.name === "bash" && cmdArgs.command
            ? await runBash(cmdArgs.command)
            : `Unknown tool: ${call.name}`;

        console.log(
          `[tool] bash: ${(cmdArgs.command ?? "").slice(0, 120)}`,
          output.length > 200 ? `→ ${output.length} chars` : `→ ${output.slice(0, 80)}`
        );

        return {
          functionResponse: {
            name: call.name,
            response: { output },
          },
        };
      })
    );

    response = await withRetry(() => chat.sendMessage(toolResults));
  }

  return response.response.text();
}

// ─── Supervisor loop ───────────────────────────────────────────────────────────

async function runSupervisorLoop(): Promise<void> {
  const mode = targetPR ? `PR review (PR #${targetPR})` : "full supervisor sweep";
  console.log(`[daemon] Starting ${mode} for repos: ${TARGET_REPOS.join(", ")}`);

  const trace = createTrace("supervisor-run", {
    mode,
    model: "gemini-2.0-flash",
    repos: TARGET_REPOS,
    prNumber: targetPR,
  });

  const errors: Array<{ repo: string; error: string }> = [];

  for (const repo of TARGET_REPOS) {
    const repoSpan = trace.span(`process-repo-${repo}`, { repo });

    // Set the right installation token for this org before gh CLI calls
    const owner = repo.split("/")[0];
    await bootstrapGitHubToken(owner);

    console.log(`[daemon] Processing repo: ${repo}`);

    const prompt = targetPR
      ? buildPRPrompt(repo, targetPR)
      : buildSweepPrompt(repo);

    try {
      const result = await runAgent(prompt);
      console.log(`[daemon] [${repo}] Done:`, result.slice(0, 200));
      repoSpan.end({ result });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[daemon] ERROR processing ${repo}:`, errorMsg);
      errors.push({ repo, error: errorMsg });
      repoSpan.end({ error: errorMsg });
    }
  }

  const summary = {
    reposProcessed: TARGET_REPOS.length,
    model: "gemini-2.0-flash",
    errors: errors.length,
    errorDetails: errors,
  };
  trace.end(summary);

  console.log("[daemon] Run complete:", summary);

  await flushTraces();

  if (errors.length > 0) {
    console.error("[daemon] Errors encountered:", errors);
    process.exit(1);
  }
}

runSupervisorLoop().catch((err) => {
  console.error("[daemon] Fatal error:", err);
  flushTraces()
    .catch(() => {})
    .finally(() => process.exit(1));
});
