#!/usr/bin/env bash
# Skill usage confirmation hook - prints to console when a skill is used

# Read JSON input from stdin
input=$(cat)

# Extract skill name using grep with Perl regex
skill_name=$(echo "$input" | grep -oP '"skill"\s*:\s*"\K[^"]+' || echo "unknown")

# Print to stderr (visible to user in terminal)
echo "✓ Skill activated: $skill_name" >&2

# Always allow (exit 0)
exit 0
