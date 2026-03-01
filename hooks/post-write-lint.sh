#!/bin/bash
# hooks/post-write-lint.sh
# PostToolUse linter: runs after Edit/Write tool calls
# Runs ASYNC (does not block the agent session)
#
# Supported linters (installed via npm):
#   - TypeScript type-check: tsc --noEmit
#   - Future: ESLint (add if eslint is added to package.json)

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only process TypeScript files
if [[ "$FILE_PATH" == *.ts ]]; then
  PROJECT_ROOT=$(echo "$INPUT" | jq -r '.cwd // "."')

  echo "[post-write-lint] Type-checking $FILE_PATH..."

  # Run tsc in noEmit mode to catch type errors after the write
  cd "$PROJECT_ROOT"
  if ! npx tsc --noEmit 2>&1; then
    echo "[post-write-lint] TypeScript errors detected in $FILE_PATH" >&2
    echo "[post-write-lint] Run 'npx tsc --noEmit' to see full error list" >&2
    # Note: PostToolUse hooks cannot block (exit 2 is ignored for PostToolUse)
    # This is informational only
  else
    echo "[post-write-lint] TypeScript OK: $FILE_PATH"
  fi
fi

exit 0
