# Agent Supervisor — Claude Instructions

This repo contains the supervisor agent system for automated multi-repo code review.
All agents operating in this repo MUST follow these rules without exception.

## Bot Identity (MANDATORY)

All automated commits, PRs, and review comments are authored by `supervisor-bot[bot]`.
Humans must always know when they are interacting with a bot.

### Git Commit Identity

NEVER use `git config --global` to set bot identity. Use environment variables per-commit:

```bash
GIT_AUTHOR_NAME="supervisor-bot[bot]" \
GIT_AUTHOR_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
GIT_COMMITTER_NAME="supervisor-bot[bot]" \
GIT_COMMITTER_EMAIL="supervisor-bot[bot]@users.noreply.github.com" \
git commit -m "feat: auto-commit from supervisor loop"
```

### PR and Review Comments

All PR review comments must begin with `**[supervisor-bot]**` prefix so humans know immediately they are reading automated feedback. Example:

> **[supervisor-bot]** Quality gate review: APPROVED
> No critical issues found. 2 warnings (see below).

### Co-Authorship on Human-Assisted Commits

When a human and the supervisor agent collaborate on a commit, add:
```
Co-Authored-By: supervisor-bot[bot] <supervisor-bot[bot]@users.noreply.github.com>
```

## Branch Policy

- NEVER push directly to `main` or `master`
- All changes go through feature branches: `feat/<feature>` or `fix/<issue>`
- PRs required for all merges
- The PreToolUse hook blocks direct pushes to protected branches (hooks/pre-tool-quality-gate.sh)

## Commit Format

```
<type>: <description>
```

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`

## Agent Rules

### Subagents
- Subagents CANNOT spawn other subagents (use Task tool from main agent only)
- Never include `Task` in a subagent's `tools` array
- Set `maxTurns: 30` in all AgentDefinition configs to prevent infinite loops

### Hook Handlers
- PreToolUse hooks with `type: "agent"` (LLM eval) are SLOW — only use for high-stakes gates
- Use `type: "command"` with fast regex for routine gates
- Set `async: true` for PostToolUse hooks that don't need to block execution

### Secrets
- NEVER echo API keys or private keys to stdout
- Use `op read "op://Personal/..."` for secrets in scripts
- The PreToolUse quality gate hook blocks credential echoing

## Security

- Store all secrets in 1Password using `op` CLI
- Tag secrets: `supervisor-agent`, `github-app`
- `.env` files MUST be gitignored (already in .gitignore)
- Private keys (.pem, .p8) MUST be gitignored

## Session Protocol

On session start, check:
1. `git branch` — confirm you are NOT on main
2. `git status` — know what's already changed
3. `cat .env.example` — know what env vars are required

## Observability

All supervisor runs emit traces to Langfuse. Check http://localhost:3000 for:
- Trace tree (which agent called what)
- Token usage per run
- Quality metrics over time
