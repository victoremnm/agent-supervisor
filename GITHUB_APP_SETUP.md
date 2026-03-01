# GitHub App Setup Guide

The supervisor system requires a dedicated GitHub App for bot identity. This gives:
- Separate `supervisor-bot[bot]` identity (humans see bot interactions clearly)
- 15,000 API requests/hour (vs 5,000 for PATs)
- Fine-grained per-repo permissions (install on target repos only)
- Independent lifecycle (survives personal account changes)

## Step 1: Create the GitHub App

1. Go to: https://github.com/settings/apps/new
2. Fill in:
   - **GitHub App name:** `yourname-supervisor` (shown as `yourname-supervisor[bot]`)
   - **Homepage URL:** `https://github.com/yourname/agent-supervisor`
   - **Webhook:** Uncheck "Active" for now (enable later for PR webhooks)
3. Set **Repository permissions:**
   - Contents: **Read & write**
   - Pull requests: **Read & write**
   - Issues: **Read & write**
   - Checks: **Read & write**
4. Set **Account permissions:** None needed
5. Under "Where can this GitHub App be installed?": Select **Only on this account**
6. Click **Create GitHub App**

## Step 2: Note the App ID

On the app settings page, note the **App ID** (a number like `123456`).

Store in 1Password:
```bash
op item create --category login --title "Supervisor Agent Secrets" --vault Personal \
  --tags "supervisor-agent,github-app" \
  "GITHUB_APP_ID[password]=123456"
```

## Step 3: Generate a Private Key

1. Scroll to **Private keys** on the app settings page
2. Click **Generate a private key**
3. A `.pem` file downloads automatically

Store in 1Password (convert to single-line for env var):
```bash
PRIVATE_KEY=$(cat ~/Downloads/yourname-supervisor.*.private-key.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}')
op item edit "Supervisor Agent Secrets" --vault Personal "GITHUB_APP_PRIVATE_KEY[password]=$PRIVATE_KEY"
# Delete the downloaded .pem file
rm ~/Downloads/yourname-supervisor.*.private-key.pem
```

## Step 4: Install the App on Target Repos

1. Go to: https://github.com/settings/apps/yourname-supervisor/installations
2. Click **Install**
3. Select **Only select repositories**
4. Add each target repo (e.g., `yourname/repo1`, `yourname/repo2`)
5. Click **Install**

Get the installation ID:
```bash
GITHUB_TOKEN=$(gh auth token)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/app/installations | jq '.[0].id'
```

Store in 1Password:
```bash
op item edit "Supervisor Agent Secrets" --vault Personal \
  "GITHUB_APP_INSTALLATION_ID[password]=<id from above>"
```

## Step 5: Configure GitHub Actions Secrets

In the `agent-supervisor` repo, add these secrets at Settings -> Secrets and variables -> Actions:

```
ANTHROPIC_API_KEY    — from 1Password: op read "op://Personal/Supervisor Agent Secrets/ANTHROPIC_API_KEY"
GH_APP_ID            — from 1Password: op read "op://Personal/Supervisor Agent Secrets/GITHUB_APP_ID"
GH_APP_PRIVATE_KEY   — from 1Password: op read "op://Personal/Supervisor Agent Secrets/GITHUB_APP_PRIVATE_KEY"
GH_APP_INSTALLATION_ID — from 1Password: op read "op://Personal/Supervisor Agent Secrets/GITHUB_APP_INSTALLATION_ID"
LANGFUSE_SECRET_KEY  — from Langfuse dashboard after docker compose up
LANGFUSE_PUBLIC_KEY  — from Langfuse dashboard after docker compose up
LANGFUSE_HOST        — the public URL of your Langfuse instance
TARGET_REPOS         — comma-separated: "yourname/repo1,yourname/repo2"
```

> **Note:** GitHub Actions reserves the `GITHUB_` prefix for built-in variables.
> Secrets are stored with the `GH_APP_` prefix but mapped to `GITHUB_APP_*` env vars by the workflow,
> which is what the TypeScript code reads.

## Step 6: Verify Bot Identity

After setup, commit something from the supervisor daemon and verify the commit shows `supervisor-bot[bot]` as the author in GitHub's UI.

## Webhook Setup (Optional — for pr-review-hook.yml)

To trigger reviews on PR open/update events:
1. Edit the app settings at https://github.com/settings/apps/yourname-supervisor
2. Enable Webhook, set URL to your server's webhook endpoint
3. Set a Webhook secret, store in 1Password
4. Subscribe to events: **Pull request** (opened, synchronize, reopened)
