#!/bin/bash
# Stop hook: Format code after Claude finishes editing
#
# This hook runs after Claude's response completes and formats any changed
# TypeScript files using the project's lint configuration.
#
# Features:
# - Only runs if TypeScript files were modified
# - Uses existing `bun run lint --fix` which includes Prettier via ESLint config
# - Non-blocking: continues even if lint has warnings/errors
# - Silent execution (no output unless errors)

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	exit 0
fi

# Check if there are any modified or staged TypeScript files
CHANGED_TS_FILES=$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep -E '\.tsx?$' || true)
STAGED_TS_FILES=$(git diff --name-only --cached --diff-filter=ACMR 2>/dev/null | grep -E '\.tsx?$' || true)

# If no TypeScript files changed, exit early
if [ -z "$CHANGED_TS_FILES" ] && [ -z "$STAGED_TS_FILES" ]; then
	exit 0
fi

# Run lint with auto-fix
# Using || true to prevent hook failure on lint errors/warnings
bun run lint --fix 2>/dev/null || true

exit 0
