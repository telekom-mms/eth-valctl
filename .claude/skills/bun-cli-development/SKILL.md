# Bun CLI Development Skill

This skill provides comprehensive guidance for building CLI applications with Bun runtime and TypeScript.

## When to Use This Skill

Use this skill when:
- Creating new CLI commands or subcommands
- Working with Bun's native APIs (file I/O, process, spawn)
- Building native executables with `bun build --compile`
- Writing tests with `bun:test` framework
- Implementing CLI patterns (argument parsing, prompts, progress indicators)

## Technology Stack

- **Runtime:** Bun (JavaScript/TypeScript runtime)
- **Language:** TypeScript (strict mode)
- **CLI Framework:** Commander.js
- **Prompts:** prompts library (interactive input)
- **Styling:** chalk (terminal colors)
- **Build:** `bun build --compile` for native binaries

## Resource Files

For detailed guidance, refer to these resource files:

| Resource | Purpose |
|----------|---------|
| [project-setup.md](resources/project-setup.md) | tsconfig, bunfig, directory structure, naming |
| [bun-runtime.md](resources/bun-runtime.md) | Bun native APIs, file I/O, process handling |
| [typescript-patterns.md](resources/typescript-patterns.md) | TypeScript strict mode, ESM, type patterns |
| [cli-patterns.md](resources/cli-patterns.md) | CLI conventions, prompts, colors, progress |
| [build-packaging.md](resources/build-packaging.md) | Native binary compilation, cross-platform |
| [testing.md](resources/testing.md) | bun:test framework, CLI testing patterns |

---

## Quick Reference

### Project Structure

```
project/
├── src/
│   ├── cli/           # Command definitions (thin layer)
│   │   ├── main.ts    # Entry point, global options
│   │   └── *.ts       # One file per command
│   ├── service/       # Business logic
│   │   ├── domain/    # Core operations
│   │   └── validation/# Input validation
│   ├── model/         # Type definitions
│   └── constants/     # Configuration values
├── tests/             # Test files
├── package.json
├── tsconfig.json
└── bun.lock
```

### CLI Layer Pattern

```typescript
// src/cli/main.ts - Entry point
import { program } from 'commander';
import { consolidateCommand } from './consolidate';

program
  .name('my-cli')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose output');

// Register subcommands
program.addCommand(consolidateCommand);

program.parseAsync(process.argv).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

```typescript
// src/cli/consolidate.ts - Subcommand
import { Command } from 'commander';
import { consolidateService } from '../service/domain/consolidate';

export const consolidateCommand = new Command('consolidate')
  .description('Consolidate resources')
  .requiredOption('-s, --source <items...>', 'Source items')
  .requiredOption('-t, --target <item>', 'Target item')
  .action(async (options) => {
    await consolidateService.execute(options);
  });
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage/argument error |
| 130 | SIGINT (Ctrl+C) |
| 143 | SIGTERM |

### Standard Streams

- **stdout:** Normal output, machine-readable data
- **stderr:** Errors, warnings, progress, logging

```typescript
// Correct usage
console.log(JSON.stringify(result));  // stdout - data
console.error('Processing...');        // stderr - status
console.error('Error: Invalid input'); // stderr - errors
```

### Signal Handling

```typescript
process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, shutting down...');
  cleanup();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down...');
  cleanup();
  process.exit(143);
});
```

### Color Output with chalk

```typescript
import chalk from 'chalk';

// Semantic colors
console.error(chalk.red('Error: Operation failed'));
console.error(chalk.yellow('Warning: Deprecated option'));
console.log(chalk.green('Success: Operation completed'));
console.error(chalk.blue('Info: Processing...'));

// TTY detection (chalk handles automatically)
// NO_COLOR env var is respected automatically
```

### Interactive Prompts

```typescript
import prompts from 'prompts';

// Check TTY before prompting
if (!process.stdin.isTTY) {
  console.error('Error: Interactive mode requires TTY');
  process.exit(1);
}

// Secret input (hidden)
const { privateKey } = await prompts({
  type: 'password',
  name: 'privateKey',
  message: 'Enter private key:'
});

// Confirmation
const { confirmed } = await prompts({
  type: 'confirm',
  name: 'confirmed',
  message: 'Proceed with operation?',
  initial: false
});
```

### Building Native Binaries

```bash
# Development build
bun build --compile ./src/cli/main.ts --outfile my-cli

# Production build with optimizations
bun build --compile --minify --bytecode --sourcemap \
  ./src/cli/main.ts --outfile my-cli

# Cross-platform builds
bun build --compile --target=bun-linux-x64 ./src/cli/main.ts --outfile my-cli-linux
bun build --compile --target=bun-darwin-arm64 ./src/cli/main.ts --outfile my-cli-macos
bun build --compile --target=bun-windows-x64 ./src/cli/main.ts --outfile my-cli.exe
```

### Testing with bun:test

```typescript
import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';

describe('MyService', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup - restore mocks
  });

  test('should process items correctly', async () => {
    // Arrange
    const input = { items: ['a', 'b'] };

    // Act
    const result = await myService.process(input);

    // Assert
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
  });
});
```

### CLI Testing

```typescript
import { test, expect } from 'bun:test';

test('should show help and exit with 0', async () => {
  const proc = Bun.spawn(['./my-cli', '--help']);
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();

  expect(exitCode).toBe(0);
  expect(stdout).toContain('Usage:');
});

test('should exit with 2 for invalid arguments', async () => {
  const proc = Bun.spawn(['./my-cli', '--invalid']);
  const exitCode = await proc.exited;

  expect(exitCode).toBe(2);
});
```

---

## Core Principles

### 1. Layer Separation

- **CLI Layer:** Argument parsing, user interaction (thin)
- **Service Layer:** Business logic, domain operations
- **Model Layer:** Type definitions, interfaces

### 2. Exit Codes Matter

- Always exit explicitly with `process.exit(code)`
- Use correct codes for shell scripting/CI integration
- Non-zero on ANY error condition

### 3. Streams Separation

- Data to stdout (for piping)
- Everything else to stderr
- Enable `cmd > output.json 2> log.txt`

### 4. TTY Awareness

- Check `process.stdout.isTTY` for colors/progress
- Check `process.stdin.isTTY` for prompts
- Respect `NO_COLOR` environment variable

### 5. Graceful Shutdown

- Handle SIGINT and SIGTERM
- Clean up resources (connections, file handles)
- Exit with appropriate code (130/143)

### 6. User-Friendly Errors

- Clear, actionable error messages
- No stack traces by default (--verbose to show)
- Include suggestions for common issues

---

## Common Patterns

### Batch Operation with Progress

```typescript
import chalk from 'chalk';

async function processBatch(items: string[]): Promise<void> {
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Progress to stderr (doesn't pollute stdout)
    if (process.stderr.isTTY) {
      process.stderr.write(`\rProcessing ${i + 1}/${total}...`);
    } else {
      // Non-TTY: periodic status
      if (i % 10 === 0) {
        console.error(`Processing ${i + 1}/${total}`);
      }
    }

    await processItem(item);
  }

  // Clear progress line
  if (process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(50) + '\r');
  }

  console.error(chalk.green(`Completed ${total} items`));
}
```

### Error Handling Wrapper

```typescript
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(chalk.red(`Validation error: ${error.message}`));
      process.exit(2);
    }

    console.error(chalk.red(`Error: ${error.message}`));

    if (process.env.DEBUG) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

main();
```

### Confirmation for Dangerous Operations

```typescript
import prompts from 'prompts';

async function confirmDangerousOperation(
  message: string,
  force: boolean
): Promise<boolean> {
  if (force) {
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error('Error: Use --force flag in non-interactive mode');
    process.exit(1);
  }

  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: chalk.yellow(message),
    initial: false
  });

  return confirmed;
}

// Usage
if (await confirmDangerousOperation('Delete all items?', options.force)) {
  await deleteAllItems();
}
```

---

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Package.json Scripts

```json
{
  "scripts": {
    "start": "bun run src/cli/main.ts",
    "format": "bunx prettier --write .",
    "format:check": "bunx prettier --check .",
    "lint": "bunx eslint . --ext .ts --fix",
    "typecheck": "bun run --bun tsc --noEmit",
    "build": "bun build --compile --minify --bytecode ./src/cli/main.ts --outfile my-cli",
    "build:linux": "bun build --compile --target=bun-linux-x64 ./src/cli/main.ts --outfile dist/my-cli-linux",
    "build:macos": "bun build --compile --target=bun-darwin-arm64 ./src/cli/main.ts --outfile dist/my-cli-macos",
    "build:windows": "bun build --compile --target=bun-windows-x64 ./src/cli/main.ts --outfile dist/my-cli.exe",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "clean": "rm -rf dist my-cli"
  }
}
```

---

## Related Resources

- [Bun Documentation](https://bun.sh/docs)
- [Commander.js](https://github.com/tj/commander.js)
- [chalk](https://github.com/chalk/chalk)
- [prompts](https://github.com/terkelg/prompts)
