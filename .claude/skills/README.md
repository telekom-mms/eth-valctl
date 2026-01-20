# Skills

Production-tested skills for Claude Code that auto-activate based on context.

---

## What Are Skills?

Skills are modular knowledge bases that Claude loads when needed. They provide:
- Domain-specific guidelines
- Best practices
- Code examples
- Anti-patterns to avoid

**Problem:** Skills don't activate automatically by default.

**Solution:** This showcase includes the hooks + configuration to make them activate.

---

## Available Skills

### skill-developer (Meta-Skill)
**Purpose:** Creating and managing Claude Code skills

**Files:** 7 resource files (426 lines total)

**Use when:**
- Creating new skills
- Understanding skill structure
- Working with skill-rules.json
- Debugging skill activation

**Customization:** ✅ None - copy as-is

**[View Skill →](skill-developer/)**

---

### bun-cli-development
**Purpose:** Bun runtime and TypeScript CLI development patterns

**Files:** 5 resource files (~350 lines main + resources)

**Covers:**
- Bun native APIs (file I/O, process spawning)
- TypeScript strict mode patterns
- Commander.js CLI patterns
- Exit codes and error handling
- Colors, progress, and user prompts
- Native binary compilation
- Testing with bun:test

**Use when:**
- Creating/modifying CLI commands
- Working with Bun APIs
- Building TypeScript utilities
- Packaging native binaries

**Customization:** ⚠️ Update `pathPatterns` in skill-rules.json to match your source directories

**Example pathPatterns:**
```json
{
  "pathPatterns": [
    "src/**/*.ts",           // Standard src directory
    "src/cli/**/*.ts",       // CLI-specific code
    "lib/**/*.ts"            // Library code
  ]
}
```

**[View Skill →](bun-cli-development/)**

---

### ethereum-development
**Purpose:** Ethereum validator management and blockchain development

**Files:** 5 resource files (~350 lines main + resources)

**Covers:**
- Validator lifecycle and states
- Beacon API queries
- Execution layer JSON-RPC
- BLS cryptography and signatures
- EIP-7251 (Consolidation) and EIP-7002 (Withdrawals/Exits)
- ethers.js v6 patterns

**Use when:**
- Building validator management tools
- Querying Beacon or Execution layer
- Implementing Pectra EIP operations
- Working with BLS signatures

**Customization:** ⚠️ Update `pathPatterns` for your validator code

**Example pathPatterns:**
```json
{
  "pathPatterns": [
    "src/service/domain/**/*.ts",
    "src/service/validation/**/*.ts",
    "src/model/ethereum.ts"
  ]
}
```

**[View Skill →](ethereum-development/)**

---

## How to Add a Skill to Your Project

### Quick Integration

**For Claude Code:**
```
User: "Add the bun-cli-development skill to my project"

Claude should:
1. Ask about project structure
2. Copy skill directory
3. Update skill-rules.json with their paths
4. Verify integration
```

See [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md) for complete instructions.

### Manual Integration

**Step 1: Copy the skill directory**
```bash
cp -r claude-code-infrastructure-showcase/.claude/skills/bun-cli-development \
      your-project/.claude/skills/
```

**Step 2: Update skill-rules.json**

If you don't have one, create it:
```bash
cp claude-code-infrastructure-showcase/.claude/skills/skill-rules.json \
   your-project/.claude/skills/
```

Then customize the `pathPatterns` for your project:
```json
{
  "skills": {
    "bun-cli-development": {
      "fileTriggers": {
        "pathPatterns": [
          "YOUR_SOURCE_PATH/**/*.ts"  // ← Update this!
        ]
      }
    }
  }
}
```

**Step 3: Test**
- Edit a file in your source directory
- The skill should activate automatically

---

## skill-rules.json Configuration

### What It Does

Defines when skills should activate based on:
- **Keywords** in user prompts ("bun", "cli", "command")
- **Intent patterns** (regex matching user intent)
- **File path patterns** (editing source files)
- **Content patterns** (code contains Commander imports)

### Configuration Format

```json
{
  "skill-name": {
    "type": "domain" | "guardrail",
    "enforcement": "suggest" | "block",
    "priority": "high" | "medium" | "low",
    "promptTriggers": {
      "keywords": ["list", "of", "keywords"],
      "intentPatterns": ["regex patterns"]
    },
    "fileTriggers": {
      "pathPatterns": ["path/to/files/**/*.ts"],
      "contentPatterns": ["from 'commander'"]
    }
  }
}
```

### Enforcement Levels

- **suggest**: Skill appears as suggestion, doesn't block
- **block**: Must use skill before proceeding (guardrail)

**Use "block" for:**
- Preventing breaking changes
- Critical operations
- Security-sensitive code

**Use "suggest" for:**
- General best practices
- Domain guidance
- Code organization

---

## Creating Your Own Skills

See the **skill-developer** skill for complete guide on:
- Skill YAML frontmatter structure
- Resource file organization
- Trigger pattern design
- Testing skill activation

**Quick template:**
```markdown
---
name: my-skill
description: What this skill does
---

# My Skill Title

## Purpose
[Why this skill exists]

## When to Use This Skill
[Auto-activation scenarios]

## Quick Reference
[Key patterns and examples]

## Resource Files
- [topic-1.md](resources/topic-1.md)
- [topic-2.md](resources/topic-2.md)
```

---

## Troubleshooting

### Skill isn't activating

**Check:**
1. Is skill directory in `.claude/skills/`?
2. Is skill listed in `skill-rules.json`?
3. Do `pathPatterns` match your files?
4. Are hooks installed and working?
5. Is settings.json configured correctly?

**Debug:**
```bash
# Check skill exists
ls -la .claude/skills/

# Validate skill-rules.json
cat .claude/skills/skill-rules.json | jq .

# Check hooks are executable
ls -la .claude/hooks/*.sh

# Test hook manually
./.claude/hooks/skill-activation-prompt.sh
```

### Skill activates too often

Update skill-rules.json:
- Make keywords more specific
- Narrow `pathPatterns`
- Increase specificity of `intentPatterns`

### Skill never activates

Update skill-rules.json:
- Add more keywords
- Broaden `pathPatterns`
- Add more `intentPatterns`

---

## For Claude Code

**When integrating a skill for a user:**

1. **Read [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md)** first
2. Ask about their project structure
3. Customize `pathPatterns` in skill-rules.json
4. Verify the skill file has no hardcoded paths
5. Test activation after integration

**Common mistakes:**
- Keeping example paths from showcase
- Not asking about project structure
- Copying skill-rules.json without customization

---

## Next Steps

1. **Start simple:** Add one skill that matches your work
2. **Verify activation:** Edit a relevant file, skill should suggest
3. **Add more:** Once first skill works, add others
4. **Customize:** Adjust triggers based on your workflow

**Questions?** See [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md) for comprehensive integration instructions.
