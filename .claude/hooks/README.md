# Hooks

Claude Code hooks that enable skill auto-activation, file tracking, and code formatting.

**Requirement:** These hooks require [Bun](https://bun.sh) runtime.

---

## What Are Hooks?

Hooks are scripts that run at specific points in Claude's workflow:
- **UserPromptSubmit**: When user submits a prompt
- **PreToolUse**: Before a tool executes
- **PostToolUse**: After a tool completes
- **Stop**: When Claude's response completes

**Key insight:** Hooks can modify prompts, block actions, and track state - enabling features Claude can't do alone.

---

## Available Hooks (3)

### Essential Hooks

These two hooks are the foundation of skill auto-activation. **Start here.**

---

### skill-activation-prompt (UserPromptSubmit)

**Purpose:** Automatically suggests relevant skills based on user prompts and file context

**How it works:**
1. Reads `skill-rules.json`
2. Matches user prompt against trigger patterns
3. Checks which files user is working with
4. Injects skill suggestions into Claude's context

**Why it's essential:** This is THE hook that makes skills auto-activate.

**Integration:**
```bash
# Copy both files
cp skill-activation-prompt.sh your-project/.claude/hooks/
cp skill-activation-prompt.ts your-project/.claude/hooks/

# Make executable
chmod +x your-project/.claude/hooks/skill-activation-prompt.sh
```

**Requirement:** Bun runtime (no npm dependencies needed)

**Add to settings.json:**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/skill-activation-prompt.sh"
          }
        ]
      }
    ]
  }
}
```

**Customization:** ✅ None needed - reads skill-rules.json automatically

---

### post-tool-use-tracker (PostToolUse)

**Purpose:** Tracks file changes to maintain context across sessions

**How it works:**
1. Monitors Edit/Write/MultiEdit tool calls
2. Records which files were modified
3. Creates cache for context management
4. Auto-detects project structure

**Why it's essential:** Helps Claude understand what parts of your codebase are active.

**Integration:**
```bash
# Copy file
cp post-tool-use-tracker.sh your-project/.claude/hooks/

# Make executable
chmod +x your-project/.claude/hooks/post-tool-use-tracker.sh
```

**Add to settings.json:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use-tracker.sh"
          }
        ]
      }
    ]
  }
}
```

**Customization:** ✅ None needed - auto-detects structure

---

### Optional Hook

---

### code-format (Stop)

**Purpose:** Formats code after Claude finishes editing

**How it works:**
1. Runs when Claude's response completes
2. Checks if any TypeScript files were modified
3. Runs `bun run lint --fix` if changes detected
4. Non-blocking: continues even if lint has warnings

**When to use:**
- You want consistent code formatting after Claude edits
- Your project has ESLint/Prettier configured via `bun run lint`

**Integration:**
```bash
# Copy file
cp code-format.sh your-project/.claude/hooks/

# Make executable
chmod +x your-project/.claude/hooks/code-format.sh
```

**Add to settings.json:**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/code-format.sh"
          }
        ]
      }
    ]
  }
}
```

**Customization:**
- ⚠️ Minimal - default uses `bun run lint --fix`
- If using different lint command, update the script

**Requirements:**
- Git repository (uses git diff to detect changes)
- `lint` script in package.json that runs your linter

---

## Quick Start

**Minimum viable setup (15 minutes):**

1. Ensure Bun is installed:
   ```bash
   bun --version  # Should show version number
   ```

1. Copy essential hooks:
   ```bash
   cp showcase/.claude/hooks/skill-activation-prompt.* your-project/.claude/hooks/
   cp showcase/.claude/hooks/post-tool-use-tracker.sh your-project/.claude/hooks/
   chmod +x your-project/.claude/hooks/*.sh
   ```

1. Add to settings.json:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/skill-activation-prompt.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use-tracker.sh"
          }
        ]
      }
    ]
  }
}
```

1. Add at least one skill with skill-rules.json

1. Test: Edit a file that matches your skill patterns

**Note:** No npm dependencies required - Bun natively runs TypeScript.

---

## Troubleshooting

### Hooks not running

**Check:**
```bash
# Are hooks executable?
ls -la .claude/hooks/*.sh
# Should show: -rwxr-xr-x

# Test hook manually
./.claude/hooks/skill-activation-prompt.sh
```

### Skill activation not working

**Check:**
1. Is skill-rules.json valid JSON?
   ```bash
   cat .claude/skills/skill-rules.json | jq .
   ```
2. Do pathPatterns match your files?
3. Are keywords in your prompts?

### Bun not installed

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
```

---

## For Claude Code

**When setting up hooks for a user:**

1. **Read [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md)** first
2. **Always start with the two essential hooks**
3. **Ask before adding Stop hook** - requires lint setup
4. **Verify after setup:**
   ```bash
   ls -la .claude/hooks/*.sh | grep rwx
   ```

**Questions?** See [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md)
