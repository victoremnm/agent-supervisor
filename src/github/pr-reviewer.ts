// src/github/pr-reviewer.ts
// PR review posting and labeling via GitHub App Octokit.
// All reviews are posted as supervisor-bot[bot].
// Source: https://docs.github.com/en/rest/pulls/reviews

import { getInstallationOctokit } from "./app.js";

export type ReviewDecision = "approve" | "block" | "comment";

export interface ReviewResult {
  decision: ReviewDecision;
  critical: string[];
  warnings: string[];
  suggestions: string[];
  summary: string;
}

const BOT_PREFIX = "**[supervisor-bot]**";

/**
 * Post a PR review (approve or request changes) as supervisor-bot[bot].
 * The review body is always prefixed with BOT_PREFIX so humans immediately
 * identify automated feedback.
 */
export async function postReview(
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult
): Promise<void> {
  const octokit = await getInstallationOctokit(owner, repo);

  const event =
    result.decision === "approve"
      ? ("APPROVE" as const)
      : ("REQUEST_CHANGES" as const);

  const criticalSection =
    result.critical.length > 0
      ? `\n\n**Critical issues:**\n${result.critical.map((c) => `- ${c}`).join("\n")}`
      : "";

  const warningsSection =
    result.warnings.length > 0
      ? `\n\n**Warnings:**\n${result.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";

  const body =
    `${BOT_PREFIX} Quality gate: ${result.decision === "approve" ? "APPROVED" : "BLOCKED"}\n\n` +
    result.summary +
    criticalSection +
    warningsSection;

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
  });
}

/**
 * Add labels to a PR. Creates labels if they do not exist.
 */
export async function addLabels(
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[]
): Promise<void> {
  const octokit = await getInstallationOctokit(owner, repo);

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels,
  });
}

/**
 * Convenience: post a blocking review and apply needs-changes label.
 */
export async function postBlockingReview(
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult
): Promise<void> {
  await postReview(owner, repo, prNumber, result);
  await addLabels(owner, repo, prNumber, ["bot-reviewed", "needs-changes"]);
}

/**
 * Convenience: post an approving review and apply auto-approved label.
 */
export async function postApprovingReview(
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult
): Promise<void> {
  await postReview(owner, repo, prNumber, result);
  await addLabels(owner, repo, prNumber, ["bot-reviewed", "auto-approved"]);
}
