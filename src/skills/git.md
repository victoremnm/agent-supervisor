# Bot Identity Git Rules

Reference document for all agents performing git operations in the supervisor system.

## Why Bot Identity Matters

When the supervisor commits code or opens PRs, humans must be able to tell it came from the bot — not from a human developer. GitHub shows the committer name and email on every commit. Using bot identity:
- Provides a clear audit trail (which commits are automated)
- Prevents confusion when reviewing git history
- Separates bot activity from human activity in GitHub's contributor graph

## The Pattern: Environment Variables (Not Global Config)

**NEVER** use `git config --global user.name` to set bot identity. This pollutes the global git config and affects all repos on the machine.

**ALWAYS** use environment variables per-commit:

```bash
GIT_AUTHOR_NAME="supervisor-bot[bot]" \
GIT_AUTHOR_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
GIT_COMMITTER_NAME="supervisor-bot[bot]" \
GIT_COMMITTER_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
git commit -m "feat: automated change from supervisor loop"
```

## GitHub's No-Reply Email Convention

The email format `<username>[bot]@users.noreply.github.com` is GitHub's convention for bot accounts. GitHub renders this as a linked bot badge on the commit.

If you have registered a GitHub App named `yourname-supervisor`, the bot email will be:
`yourname-supervisor[bot]@users.noreply.github.com`

## Co-Authorship on Human-Assisted Commits

When a human initiates a change and the bot completes it, use the Co-Authored-By trailer:

```bash
git commit -m "feat: implement feature

Co-Authored-By: supervisor-bot[bot] <supervisor-bot[bot]@users.noreply.github.com>"
```

## Branch Policy

- **Main/master**: NEVER commit directly. Protected branches.
- **Feature branches**: `feat/<description>` or `fix/<description>`
- **Automated branches**: `feat/supervisor-auto-commit-YYYYMMDD` for unattended commits

## Setting Bot Identity in GitHub Actions

In GitHub Actions workflows, env vars are set at the step level:

```yaml
- name: Commit changes
  env:
    GIT_AUTHOR_NAME: "supervisor-bot[bot]"
    GIT_AUTHOR_EMAIL: "supervisor-bot[bot]@users.noreply.github.com"
    GIT_COMMITTER_NAME: "supervisor-bot[bot]"
    GIT_COMMITTER_EMAIL: "supervisor-bot[bot]@users.noreply.github.com"
  run: git commit -m "chore: automated update from supervisor"
```

## Verifying Bot Identity

After a commit, verify the author shows correctly:

```bash
git log --oneline --format="%h %an <%ae>" -1
# Should output: abc1234 supervisor-bot[bot] <supervisor-bot[bot]@users.noreply.github.com>
```

In GitHub's UI, commits from a registered GitHub App show with a `[bot]` badge next to the username.
