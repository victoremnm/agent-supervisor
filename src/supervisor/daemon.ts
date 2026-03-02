// src/supervisor/daemon.ts
// Supervisor daemon entry point.
// Triggered by: GitHub Actions cron (every hour) or PR event hook.
// Source: https://platform.claude.com/docs/en/agent-sdk/subagents

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { AGENTS } from "./agents.js";
import { bootstrapGitHubToken } from "../github/app.js";
import { createTrace, flushTraces } from "../observability/langfuse.js";

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
  console.error(
    "[daemon] Set TARGET_REPOS=owner/repo1,owner/repo2 and retry."
  );
  process.exit(1);
}

async function runSupervisorLoop(): Promise<void> {
  // Bootstrap cross-repo gh CLI access using the GitHub App installation token.
  // This must run before any agent Bash tools that call `gh pr list/diff/review`.
  await bootstrapGitHubToken();

  const mode = targetPR ? `PR review (PR #${targetPR})` : "full supervisor sweep";
  console.log(`[daemon] Starting ${mode} for repos: ${TARGET_REPOS.join(", ")}`);

  const trace = createTrace("supervisor-run", {
    mode,
    repos: TARGET_REPOS,
    prNumber: targetPR,
  });

  const errors: Array<{ repo: string; error: string }> = [];

  for (const repo of TARGET_REPOS) {
    const repoSpan = trace.span(`process-repo-${repo}`, { repo });

    console.log(`[daemon] Processing repo: ${repo}`);

    // Build the supervisor prompt based on mode
    const prompt = targetPR
      ? `
        Targeted PR review for ${repo} PR #${targetPR}:
        1. Use code-reviewer to review: gh pr diff ${targetPR} --repo ${repo}
        2. Use pr-manager to post the review result and apply labels
        Bot identity for any git operations: GIT_AUTHOR_NAME="supervisor-bot[bot]"
      `.trim()
      : `
        Full supervisor sweep for ${repo}:
        1. Use repo-scrubber to triage: check open PRs, uncommitted changes, stale branches
        2. For each open PR in the triage report (if requiresReview is true):
           a. If the PR is in largePRs list: use gemini-analyzer instead of code-reviewer
           b. Otherwise: use code-reviewer to review the diff
        3. Use pr-manager to post each review result and apply labels (bot-reviewed + auto-approved or needs-changes)
        4. Report a summary of actions taken
        Bot identity for any git operations: GIT_AUTHOR_NAME="supervisor-bot[bot]"
      `.trim();

    try {
      let lastResult = "";

      const queryOptions: Options = {
        allowedTools: ["Read", "Grep", "Glob", "Bash", "Task"],
        agents: AGENTS,
        maxTurns: 30,
      };

      for await (const message of query({
        prompt,
        options: queryOptions,
      })) {
        if ("result" in message) {
          lastResult = String(message.result);
          console.log(`[daemon] [${repo}] Done:`, lastResult.slice(0, 200));
        }
      }

      repoSpan.end({ result: lastResult });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[daemon] ERROR processing ${repo}:`, errorMsg);
      errors.push({ repo, error: errorMsg });
      repoSpan.end({ error: errorMsg });
    }
  }

  // Summary
  const summary = {
    reposProcessed: TARGET_REPOS.length,
    errors: errors.length,
    errorDetails: errors,
  };
  trace.end(summary);

  console.log("[daemon] Run complete:", summary);

  if (errors.length > 0) {
    console.error("[daemon] Errors encountered:", errors);
  }

  // Flush Langfuse traces before exit — critical, do not remove
  await flushTraces();

  // Exit with error code if any repos failed (GitHub Actions will mark the run as failed)
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run
runSupervisorLoop().catch((err) => {
  console.error("[daemon] Fatal error:", err);
  flushTraces()
    .catch(() => {})
    .finally(() => process.exit(1));
});
