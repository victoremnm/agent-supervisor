// src/github/repo-scanner.ts
// Repo scanning utilities: list open PRs, fetch diffs, check labels.
// Source: https://docs.github.com/en/rest/pulls/pulls

import { getInstallationOctokit } from "./app.js";

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  draft: boolean;
  changedFiles?: number;
}

/**
 * List all open pull requests for a repo.
 * Excludes draft PRs and PRs authored by the bot itself.
 */
export async function listOpenPRs(
  owner: string,
  repo: string
): Promise<PullRequest[]> {
  const octokit = await getInstallationOctokit(owner, repo);

  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });

  return prs
    .filter(
      (pr) =>
        // Skip draft PRs (not ready for review)
        !pr.draft &&
        // Skip PRs authored by the bot (prevent infinite review loops)
        pr.user?.login !== "supervisor-bot[bot]"
    )
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? "unknown",
      updatedAt: pr.updated_at,
      draft: pr.draft ?? false,
      // changed_files is not included in the list response; use getPRDiff or
      // a separate pulls.get call if file count is needed.
    }));
}

/**
 * Get the unified diff for a PR.
 * Returns the raw diff string. Large diffs (>200 files) should be routed to
 * gemini-analyzer for token-efficient processing.
 */
export async function getPRDiff(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const octokit = await getInstallationOctokit(owner, repo);

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: "diff" },
  });

  // The diff is returned as a string when mediaType.format is "diff"
  return data as unknown as string;
}

/**
 * Check if a PR already has a bot-reviewed label.
 * Used by the daemon to skip PRs that have already been reviewed.
 */
export async function hasBotReviewedLabel(
  owner: string,
  repo: string,
  prNumber: number
): Promise<boolean> {
  const octokit = await getInstallationOctokit(owner, repo);

  const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: prNumber,
  });

  return labels.some((label) => label.name === "bot-reviewed");
}
