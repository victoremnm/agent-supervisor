---
created: 2026-03-01T20:18:31.547Z
title: Set up GitHub App and reusable workflow
area: tooling
files:
  - GITHUB_APP_SETUP.md
  - .github/workflows/supervisor-cron.yml
---

## Problem

Two things needed before the supervisor can actually run in CI:

1. **GitHub App not created yet.** The daemon needs `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID` secrets to authenticate as `victoremnm-supervisor[bot]` when posting PR reviews and labels. Without this, the Octokit layer in `src/github/app.ts` throws on every run.

2. **supervisor-cron.yml is not reusable.** Other repos can't call the supervisor without copy-pasting the workflow. Adding `workflow_call` trigger makes `agent-supervisor` the single source of truth — consuming repos just do `uses: victoremnm/agent-supervisor/.github/workflows/supervisor-cron.yml@main`.

## Solution

### GitHub App (manual browser step required)

1. Go to https://github.com/settings/apps/new
2. Name: `victoremnm-supervisor` → shows as `victoremnm-supervisor[bot]`
3. Homepage: `https://github.com/victoremnm/agent-supervisor`
4. Webhook: uncheck Active
5. Permissions: Contents R+W, Pull requests R+W, Issues R+W, Checks R+W
6. Where installed: Only on this account
7. Create → note the App ID number
8. Generate private key → .pem downloads

Store in 1Password and set secrets:
```bash
# Store App ID
op item create --category login --title "Supervisor Agent Secrets" --vault Personal \
  --tags "supervisor-agent,github-app" \
  "GITHUB_APP_ID[password]=<app-id>"

# Store private key (single-line)
PRIVATE_KEY=$(cat ~/Downloads/victoremnm-supervisor.*.private-key.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}')
op item edit "Supervisor Agent Secrets" --vault Personal "GITHUB_APP_PRIVATE_KEY[password]=$PRIVATE_KEY"
rm ~/Downloads/victoremnm-supervisor.*.private-key.pem

# Get installation ID after installing App on repos
gh api /app/installations --header "Authorization: Bearer $(op read 'op://Personal/Supervisor Agent Secrets/GITHUB_APP_PRIVATE_KEY')" | jq '.[0].id'
op item edit "Supervisor Agent Secrets" --vault Personal "GITHUB_APP_INSTALLATION_ID[password]=<id>"

# Set GitHub Actions secrets
gh secret set GITHUB_APP_ID --repo victoremnm/agent-supervisor \
  --body "$(op read 'op://Personal/Supervisor Agent Secrets/GITHUB_APP_ID')"
gh secret set GITHUB_APP_PRIVATE_KEY --repo victoremnm/agent-supervisor \
  --body "$(op read 'op://Personal/Supervisor Agent Secrets/GITHUB_APP_PRIVATE_KEY')"
gh secret set GITHUB_APP_INSTALLATION_ID --repo victoremnm/agent-supervisor \
  --body "$(op read 'op://Personal/Supervisor Agent Secrets/GITHUB_APP_INSTALLATION_ID')"
```

### Reusable workflow

Add `workflow_call` trigger to `.github/workflows/supervisor-cron.yml`:

```yaml
on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:
    inputs:
      target_repos:
        description: "Comma-separated repos to process"
        required: false
        type: string
  workflow_call:
    inputs:
      target_repos:
        description: "Comma-separated repos to process"
        required: false
        type: string
    secrets:
      ANTHROPIC_API_KEY:
        required: true
      GITHUB_APP_ID:
        required: false
      GITHUB_APP_PRIVATE_KEY:
        required: false
      GITHUB_APP_INSTALLATION_ID:
        required: false
      TARGET_REPOS:
        required: false
```

Consuming repo usage:
```yaml
jobs:
  review:
    uses: victoremnm/agent-supervisor/.github/workflows/supervisor-cron.yml@main
    with:
      target_repos: "victoremnm/some-other-repo"
    secrets: inherit
```
