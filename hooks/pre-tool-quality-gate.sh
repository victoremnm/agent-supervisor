#!/bin/bash
# hooks/pre-tool-quality-gate.sh
# PreToolUse quality gate for all agent sessions in agent-supervisor/
# Source: https://code.claude.com/docs/en/hooks
#
# Exit codes:
#   0 = allow the tool call
#   2 = block the tool call (Claude sees the stderr message as the reason)

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

# === Bash tool gates ===
if [ "$TOOL" = "Bash" ]; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

  # Block direct pushes to protected branches
  if echo "$COMMAND" | grep -E 'git push.*(main|master|production|release)' > /dev/null 2>&1; then
    echo "BLOCKED: Direct push to protected branch is not allowed." >&2
    echo "         Create a feature branch and open a PR instead." >&2
    exit 2
  fi

  # Block force pushes (any branch)
  if echo "$COMMAND" | grep -E 'git push.*(-f|--force|--force-with-lease)' > /dev/null 2>&1; then
    echo "BLOCKED: Force push is not allowed in supervisor sessions." >&2
    exit 2
  fi

  # Block credential echoing — prevent leaking secrets to terminal/logs
  if echo "$COMMAND" | grep -E '(ANTHROPIC_API_KEY|GITHUB_APP_PRIVATE_KEY|GITHUB_TOKEN|LANGFUSE_SECRET_KEY).*echo' > /dev/null 2>&1; then
    echo "BLOCKED: Do not echo API keys or private keys to stdout." >&2
    echo "         Use 'op read' to retrieve secrets and pass them directly." >&2
    exit 2
  fi

  # Block committing directly to main (local)
  if echo "$COMMAND" | grep -E 'git checkout (main|master)' > /dev/null 2>&1; then
    # Allow reading main but warn — not a hard block since we may need to inspect it
    echo "WARNING: Switching to main branch. Make sure not to commit here." >&2
    # exit 0 (allow, just warn)
  fi
fi

# === Write/Edit tool gates ===
if [ "$TOOL" = "Write" ] || [ "$TOOL" = "Edit" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

  # Block writing to .env (should already be in .gitignore, belt-and-suspenders)
  if echo "$FILE_PATH" | grep -E '^\.env$|/\.env$' > /dev/null 2>&1; then
    echo "BLOCKED: Do not write to .env directly. Use .env.example and 1Password." >&2
    exit 2
  fi

  # Block writing private keys to source-tracked locations
  if echo "$FILE_PATH" | grep -E '\.(pem|p8|key)$' > /dev/null 2>&1; then
    echo "BLOCKED: Private key files must be stored in 1Password, not the filesystem." >&2
    exit 2
  fi
fi

exit 0
