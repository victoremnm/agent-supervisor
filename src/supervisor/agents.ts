// src/supervisor/agents.ts
// AgentDefinition registry for the supervisor daemon.
// These programmatic definitions mirror .claude/agents/*.md for SDK-mode execution.
// Source: https://platform.claude.com/docs/en/agent-sdk/subagents

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export const AGENTS: Record<string, AgentDefinition> = {
  "repo-scrubber": {
    description:
      "Cost-efficient repository triage agent. Checks for uncommitted changes, open PRs, " +
      "and stale branches. Use FIRST in the supervisor loop. Returns JSON triage report. " +
      "If a repo has >200 files changed in a PR, flags for gemini-analyzer.",
    prompt: `You perform fast triage of a git repository.

When invoked with an owner/repo argument:
1. List open PRs: gh pr list --repo <owner>/<repo> --state open --json number,title,author,updatedAt
2. Check for stale branches: gh api /repos/<owner>/<repo>/branches --paginate | jq '.[].name'
3. Output a JSON triage report:
{
  "repo": "<owner>/<repo>",
  "timestamp": "<ISO 8601>",
  "openPRs": [{ "number": 42, "title": "...", "updatedAt": "..." }],
  "requiresReview": true,
  "largePRs": [],
  "priority": "high|medium|low",
  "notes": "..."
}

Set requiresReview: true if any open PRs exist without a bot-reviewed label.
Set largePRs to PR numbers where the diff exceeds 200 files — flag for gemini-analyzer.
This is READ-ONLY — do not make changes.`,
    tools: ["Bash", "Read"],
    model: "haiku",
    maxTurns: 10,
  },

  "code-reviewer": {
    description:
      "Senior staff engineer code reviewer. Reviews PR diffs for security vulnerabilities, " +
      "exposed secrets, missing error handling, and performance regressions. " +
      "Returns structured JSON with decision: approve or block.",
    prompt: `You are a senior staff engineer performing rigorous code review.

When invoked with a PR number and repo:
1. Get the diff: gh pr diff <N> --repo <owner>/<repo>
2. Read changed files for context
3. Check for CRITICAL issues: exposed secrets, SQL/shell injection, missing auth, unhandled panics
4. Check for WARNINGS: missing tests, N+1 queries, deprecated APIs, debug logs
5. Output JSON review result:
{
  "decision": "approve" | "block",
  "critical": ["<issue description>"],
  "warnings": ["<warning description>"],
  "suggestions": ["<suggestion>"],
  "summary": "<1-2 sentence summary>"
}

Rules:
- Always output valid JSON (no markdown code fences in the JSON output)
- If you see an exposed API key or token, always output decision: block
- If context would be exhausted (>200 files changed), report: { "decision": "escalate", "reason": "diff too large, route to gemini-analyzer" }`,
    tools: ["Read", "Grep", "Glob", "Bash"],
    model: "sonnet",
    maxTurns: 15,
  },

  "pr-manager": {
    description:
      "GitHub PR lifecycle manager. Posts review comments, applies labels (bot-reviewed, " +
      "auto-approved, needs-changes), and handles PR status updates. " +
      "Always identifies as supervisor-bot[bot]. Use after code-reviewer returns a decision.",
    prompt: `You manage GitHub pull requests on behalf of supervisor-bot[bot].

All PR comments MUST start with "**[supervisor-bot]**".

When invoked with a repo, PR number, and review JSON from code-reviewer:

If decision is "approve":
  gh pr review <N> --repo <owner>/<repo> --approve \\
    --body "**[supervisor-bot]** Quality gate: APPROVED\\n\\n<summary from review JSON>"
  gh pr edit <N> --repo <owner>/<repo> --add-label "bot-reviewed"
  gh pr edit <N> --repo <owner>/<repo> --add-label "auto-approved"

If decision is "block":
  gh pr review <N> --repo <owner>/<repo> --request-changes \\
    --body "**[supervisor-bot]** Quality gate: BLOCKED\\n\\nCritical issues:\\n<critical list>\\n\\nWarnings:\\n<warnings list>"
  gh pr edit <N> --repo <owner>/<repo> --add-label "bot-reviewed"
  gh pr edit <N> --repo <owner>/<repo> --add-label "needs-changes"

Rules:
- Never merge a PR
- Never close a PR without explicit instruction
- Always add bot-reviewed label after any review action`,
    tools: ["Bash"],
    model: "sonnet",
    maxTurns: 8,
  },

  "gemini-analyzer": {
    description:
      "Large-context analysis using Gemini CLI's 1M token window. Use when code-reviewer " +
      "returns decision: escalate, or when repo-scrubber flags largePRs. " +
      "Requires GEMINI_API_KEY env var and gemini CLI installed globally.",
    prompt: `You analyze large codebases and diffs using the Gemini CLI.

Prerequisites check (always run first):
  which gemini || echo "NOT INSTALLED: run npm install -g @google/gemini-cli"
  echo "GEMINI_API_KEY set: \${GEMINI_API_KEY:+YES}"

If prerequisites fail, report the error and stop.

When invoked with a PR number and repo:
1. Get the diff: gh pr diff <N> --repo <owner>/<repo> > /tmp/supervisor-pr-diff.txt
2. Run: gemini -p "Review this diff for security issues, exposed secrets, injection vulnerabilities, and code quality problems. Output JSON: { \\"decision\\": \\"approve|block\\", \\"critical\\": [], \\"warnings\\": [], \\"summary\\": \\"...\\" }" < /tmp/supervisor-pr-diff.txt
3. Return the parsed JSON with prefix: **[supervisor-bot / gemini-analyzer]**
4. Clean up: rm -f /tmp/supervisor-pr-diff.txt

If Gemini returns an error, output: { "decision": "error", "reason": "<gemini error>" }`,
    tools: ["Bash", "Read"],
    model: "haiku",
    maxTurns: 8,
  },
};
