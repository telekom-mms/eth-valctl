# CLI Patterns

Comprehensive patterns for building professional CLI applications.

## Exit Codes

### Standard Exit Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 0 | Success | Operation completed successfully |
| 1 | General error | Runtime errors, unexpected failures |
| 2 | Usage error | Invalid arguments, missing required options |
| 130 | SIGINT | User pressed Ctrl+C |
| 143 | SIGTERM | Process received termination signal |

```typescript
// Exit code constants
const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;
const EXIT_SIGINT = 130;
const EXIT_SIGTERM = 143;

// Always exit explicitly
process.exit(EXIT_SUCCESS);
```

### Error-Specific Exit Codes

```typescript
// Define application-specific exit codes
const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  NETWORK_ERROR: 3,
  VALIDATION_ERROR: 4,
  AUTH_ERROR: 5,
} as const;

// Map error types to exit codes
function getExitCode(error: Error): number {
  if (error instanceof ValidationError) return ExitCode.VALIDATION_ERROR;
  if (error instanceof NetworkError) return ExitCode.NETWORK_ERROR;
  if (error instanceof AuthError) return ExitCode.AUTH_ERROR;
  return ExitCode.GENERAL_ERROR;
}
```

## Standard Streams

### Proper Stream Usage

```typescript
// Data output → stdout (can be piped)
console.log(JSON.stringify(result));
console.log(result.id);

// Status, progress, errors → stderr
console.error('Processing...');
console.error('Warning: deprecated option');
console.error('Error: validation failed');

// This enables proper piping:
// ./my-cli process > results.json 2> log.txt
```

### Structured Output

```typescript
interface CliOutput {
  success: boolean;
  data?: unknown;
  error?: string;
}

function outputResult(result: CliOutput): void {
  // Machine-readable JSON to stdout
  console.log(JSON.stringify(result, null, 2));
}

function outputError(message: string): void {
  // Human-readable error to stderr
  console.error(chalk.red(`Error: ${message}`));

  // Also output structured error to stdout for parsing
  console.log(JSON.stringify({ success: false, error: message }));
}
```

## Color and Formatting

### Semantic Colors

```typescript
import chalk from 'chalk';

// Consistent color scheme
const colors = {
  error: chalk.red,
  warning: chalk.yellow,
  success: chalk.green,
  info: chalk.blue,
  dim: chalk.dim,
  bold: chalk.bold,
};

// Usage
console.error(colors.error('Error: Operation failed'));
console.error(colors.warning('Warning: Deprecated option'));
console.log(colors.success('Success: Operation completed'));
console.error(colors.info('Info: Processing 10 items'));
```

### TTY Detection

```typescript
// Check if output is a terminal
const isTTY = process.stdout.isTTY;

// chalk automatically handles this, but for custom formatting:
function formatOutput(message: string, color: chalk.Chalk): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    return message; // No colors for pipes/files
  }
  return color(message);
}
```

### NO_COLOR Support

```typescript
// Respect NO_COLOR environment variable
const useColors = process.stdout.isTTY && !process.env.NO_COLOR;

// Or with chalk (automatic)
import chalk from 'chalk';

// chalk respects NO_COLOR automatically
console.log(chalk.red('Error')); // Plain text if NO_COLOR is set
```

## Progress Indication

### Simple Progress

```typescript
function showProgress(current: number, total: number): void {
  if (process.stderr.isTTY) {
    // Overwrite line in terminal
    process.stderr.write(`\rProcessing ${current}/${total}...`);
  } else {
    // Periodic updates for non-TTY
    if (current % 10 === 0 || current === total) {
      console.error(`Processing ${current}/${total}`);
    }
  }
}

// Clear progress line when done
function clearProgress(): void {
  if (process.stderr.isTTY) {
    process.stderr.write('\r' + ' '.repeat(50) + '\r');
  }
}
```

### Progress Bar

```typescript
function progressBar(current: number, total: number, width = 30): string {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentStr = `${Math.round(percent * 100)}%`.padStart(4);

  return `[${bar}] ${percentStr} (${current}/${total})`;
}

// Usage
if (process.stderr.isTTY) {
  process.stderr.write(`\r${progressBar(50, 100)}`);
}
```

### Spinner

```typescript
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  private frameIndex = 0;
  private interval?: Timer;

  start(message: string): void {
    if (!process.stderr.isTTY) {
      console.error(message);
      return;
    }

    this.interval = setInterval(() => {
      const frame = spinnerFrames[this.frameIndex];
      process.stderr.write(`\r${frame} ${message}`);
      this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
    }, 80);
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      process.stderr.write('\r' + ' '.repeat(50) + '\r');
      if (message) {
        console.error(message);
      }
    }
  }
}
```

## Interactive Prompts

### Basic Prompts

```typescript
import prompts from 'prompts';

// Text input
const { name } = await prompts({
  type: 'text',
  name: 'name',
  message: 'Enter your name:',
  validate: (value) => value.length > 0 || 'Name is required',
});

// Number input
const { amount } = await prompts({
  type: 'number',
  name: 'amount',
  message: 'Enter amount (ETH):',
  min: 0,
  max: 1000,
});

// Selection
const { network } = await prompts({
  type: 'select',
  name: 'network',
  message: 'Select network:',
  choices: [
    { title: 'Mainnet', value: 'mainnet' },
    { title: 'Goerli', value: 'goerli' },
    { title: 'Sepolia', value: 'sepolia' },
  ],
});
```

### Secret Input

```typescript
// Password/secret input (hidden)
async function promptSecret(message: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Cannot prompt for secret in non-interactive mode');
  }

  const { secret } = await prompts({
    type: 'password',
    name: 'secret',
    message,
  });

  if (!secret) {
    throw new Error('Secret is required');
  }

  return secret;
}

// Usage
const privateKey = await promptSecret('Enter private key:');
```

### Confirmation

```typescript
async function confirm(
  message: string,
  defaultValue = false
): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return defaultValue;
  }

  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message,
    initial: defaultValue,
  });

  return confirmed;
}

// Usage with force flag
async function confirmDangerous(
  message: string,
  force: boolean
): Promise<boolean> {
  if (force) return true;

  if (!process.stdin.isTTY) {
    console.error('Use --force flag in non-interactive mode');
    process.exit(1);
  }

  return confirm(message, false);
}
```

### TTY Check

```typescript
function ensureInteractive(): void {
  if (!process.stdin.isTTY) {
    console.error('Error: This command requires interactive mode');
    console.error('Hint: Use --force flag or provide all options via arguments');
    process.exit(1);
  }
}
```

## Argument Validation

### CLI Validation Patterns

```typescript
import { Command, InvalidArgumentError } from 'commander';

// Custom argument parser with validation
function parsePubkey(value: string): string {
  if (!value.match(/^0x[a-fA-F0-9]{96}$/)) {
    throw new InvalidArgumentError('Invalid pubkey format. Expected 0x + 96 hex chars');
  }
  return value;
}

function parseAmount(value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Amount must be a positive number');
  }
  return parsed;
}

// Usage with Commander
const program = new Command();

program
  .command('withdraw')
  .requiredOption('-v, --validator <pubkey>', 'Validator pubkey', parsePubkey)
  .requiredOption('-a, --amount <eth>', 'Amount in ETH', parseAmount)
  .action(async (options) => {
    // options.validator is validated
    // options.amount is a number
  });
```

### URL Validation

```typescript
function parseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Protocol must be http or https');
    }
    return value;
  } catch {
    throw new InvalidArgumentError('Invalid URL format');
  }
}
```

## Help and Documentation

### Comprehensive Help

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('eth-valctl')
  .version('1.0.0')
  .description('Ethereum validator management CLI')
  .addHelpText('after', `
Examples:
  $ eth-valctl consolidate -s 0x1234... -t 0x5678...
  $ eth-valctl withdraw -v 0x1234... -a 1.5
  $ eth-valctl exit -v 0x1234...

Environment:
  RPC_URL       JSON-RPC endpoint (default: from network config)
  BEACON_URL    Beacon API endpoint (default: from network config)
  DEBUG         Enable debug output

Exit Codes:
  0   Success
  1   General error
  2   Invalid arguments
  `);
```

### Subcommand Help

```typescript
const consolidateCmd = new Command('consolidate')
  .description('Consolidate validator balances')
  .requiredOption('-s, --source <pubkeys...>', 'Source validator pubkeys')
  .requiredOption('-t, --target <pubkey>', 'Target validator pubkey')
  .addHelpText('after', `
Example:
  $ eth-valctl consolidate -s 0x1234... 0x5678... -t 0xabcd...

Notes:
  - All source validators must have 0x02 withdrawal credentials
  - Target validator must be active
  `);
```

## Error Messages

### User-Friendly Errors

```typescript
import chalk from 'chalk';

interface ErrorContext {
  message: string;
  hint?: string;
  code?: string;
}

function showError(context: ErrorContext): void {
  console.error(chalk.red(`Error: ${context.message}`));

  if (context.hint) {
    console.error(chalk.dim(`Hint: ${context.hint}`));
  }

  if (context.code) {
    console.error(chalk.dim(`Code: ${context.code}`));
  }
}

// Usage
showError({
  message: 'Validator not found',
  hint: 'Check if the pubkey is correct and the validator is indexed',
  code: 'VALIDATOR_NOT_FOUND',
});
```

### Verbose Mode

```typescript
interface ErrorOptions {
  verbose?: boolean;
}

function handleError(error: Error, options: ErrorOptions = {}): void {
  console.error(chalk.red(`Error: ${error.message}`));

  if (options.verbose && error.stack) {
    console.error(chalk.dim('\nStack trace:'));
    console.error(chalk.dim(error.stack));
  }

  if (error.cause && error.cause instanceof Error) {
    console.error(chalk.dim(`\nCaused by: ${error.cause.message}`));
  }
}
```

## Verbosity Levels

```typescript
type LogLevel = 'quiet' | 'normal' | 'verbose' | 'debug';

class Logger {
  constructor(private level: LogLevel = 'normal') {}

  debug(message: string): void {
    if (this.level === 'debug') {
      console.error(chalk.dim(`[DEBUG] ${message}`));
    }
  }

  info(message: string): void {
    if (this.level !== 'quiet') {
      console.error(chalk.blue(`[INFO] ${message}`));
    }
  }

  warn(message: string): void {
    if (this.level !== 'quiet') {
      console.error(chalk.yellow(`[WARN] ${message}`));
    }
  }

  error(message: string): void {
    console.error(chalk.red(`[ERROR] ${message}`));
  }

  success(message: string): void {
    if (this.level !== 'quiet') {
      console.error(chalk.green(message));
    }
  }
}

// Usage
const logger = new Logger(options.verbose ? 'verbose' : 'normal');
logger.info('Starting operation...');
```
