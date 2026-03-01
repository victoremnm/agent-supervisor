# Supervisor Loop Skill

A skill for Claude Code that combs one or more git repositories for pending work,
commits uncommitted changes with bot identity, and posts code reviews on open PRs.

## How to Invoke

In any Claude Code session:
```
/skill supervisor-loop <owner>/<repo> [<owner>/<repo2> ...]
```

Or: Pass this file's path directly to Claude and say "run the supervisor loop on <repo>".

## What This Skill Does

For each target repository:
1. **Triage** (via repo-scrubber subagent or direct commands): checks for uncommitted changes, open PRs, stale branches
2. **Commit pending work** (if uncommitted changes exist): stages and commits all changes with bot identity
3. **Review open PRs** (via code-reviewer subagent or direct review): reviews each open PR diff
4. **Post results**: summarizes findings and posts review comments to GitHub

## Execution Protocol

### Step 1: Validate inputs

Parse the repository arguments. Each argument should be in `owner/repo` format.

If no repos are provided, check `TARGET_REPOS` environment variable:
```bash
echo "${TARGET_REPOS:-NOT SET}"
```

If neither is available, ask the user to provide repos.

### Step 2: For each repo — triage

Use the `repo-scrubber` subagent if available (agent-supervisor/.claude/agents/repo-scrubber.md loaded).
Otherwise, run these commands directly:

```bash
# List open PRs
gh pr list --repo <owner>/<repo> --state open --json number,title,author,updatedAt,labels

# Check local clone for uncommitted changes (if repo is cloned locally)
REPO_PATH=$(find ~/Documents/Repositories -name "<repo>" -type d -maxdepth 3 | head -1)
if [ -n "$REPO_PATH" ]; then
  git -C "$REPO_PATH" status --porcelain
fi
```

### Step 3: For each repo — commit pending work

If uncommitted changes exist in a local clone:

```bash
# Stage all changes
git -C "$REPO_PATH" add -A

# Commit with bot identity (MANDATORY — use env vars, not global gitconfig)
GIT_AUTHOR_NAME="supervisor-bot[bot]" \
GIT_AUTHOR_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
GIT_COMMITTER_NAME="supervisor-bot[bot]" \
GIT_COMMITTER_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
git -C "$REPO_PATH" commit -m "chore: auto-commit from supervisor loop [skip ci]"
```

**NEVER commit directly to main or master.** If the current branch is main/master, create a feature branch first:
```bash
git -C "$REPO_PATH" checkout -b "feat/supervisor-auto-commit-$(date +%Y%m%d)"
```

### Step 4: For each open PR — review

Use the `code-reviewer` subagent if available. Otherwise, run directly:

```bash
# Get the diff
gh pr diff <PR_NUMBER> --repo <owner>/<repo>
```

Read the diff output and assess:
- CRITICAL: exposed secrets, injection vulnerabilities, missing auth
- WARNINGS: missing tests, debug logs, deprecated APIs
- SUGGESTIONS: style, naming, simplification

### Step 5: Post review results

Use the `pr-manager` subagent if available. Otherwise, use gh CLI directly:

```bash
# Approve (no critical issues)
gh pr review <PR_NUMBER> --repo <owner>/<repo> --approve \
  --body "**[supervisor-bot]** Quality gate: APPROVED

  <summary of review>"

# Request changes (critical issues found)
gh pr review <PR_NUMBER> --repo <owner>/<repo> --request-changes \
  --body "**[supervisor-bot]** Quality gate: BLOCKED

  **Critical issues:**
  <list of critical issues>

  **Warnings:**
  <list of warnings>"

# Always add bot-reviewed label
gh pr edit <PR_NUMBER> --repo <owner>/<repo> --add-label "bot-reviewed"
```

### Step 6: Summary report

After processing all repos, output a summary table:

| Repo | Open PRs | Committed | Reviews Posted | Issues Found |
|------|----------|-----------|----------------|--------------|
| owner/repo | 3 | 0 | 3 | 1 critical |

## Rules

- **Bot identity is mandatory**: All git commits use GIT_AUTHOR_NAME/GIT_COMMITTER_NAME env vars
- **Never push to main/master**: Use feature branches for all automated commits
- **Bot review prefix**: All PR comments start with `**[supervisor-bot]**`
- **No infinite loops**: Process each repo once and exit — do not re-check after posting reviews
- **Large diffs**: If a PR diff exceeds 200 files changed, flag it for manual review rather than auto-reviewing
- **Skip already reviewed**: Check for `bot-reviewed` label before posting a new review

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- `ANTHROPIC_API_KEY` set (for subagent mode)
- GitHub App credentials set (for `supervisor-bot[bot]` identity on review comments)
  - `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`
  - OR: `GH_TOKEN` with write access (simpler but uses human identity)
- Optional: `GEMINI_API_KEY` and `gemini` CLI for large-diff analysis

## Installation

To use this skill from any Claude Code session:

```bash
# Copy to global skills directory
cp agent-supervisor/skills/supervisor-loop.md ~/.claude/skills/supervisor-loop.md

# Then in any Claude session:
# /skill supervisor-loop yourname/repo1,yourname/repo2
```
