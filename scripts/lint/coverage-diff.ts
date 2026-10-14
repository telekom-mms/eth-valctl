import { Glob } from 'bun';
import { existsSync } from 'fs';
import { relative, resolve } from 'path';

import chalk from 'chalk';

const ROOT = resolve(import.meta.dir, '..', '..');
const SRC_DIR = resolve(ROOT, 'src');

const SOURCE_GLOB = '**/*.ts';
const EXCLUDE_PATTERNS: RegExp[] = [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.d\.ts$/];

const INTENTIONAL_EXCLUDES: ReadonlySet<string> = new Set([
  'src/cli/consolidate.ts',
  'src/cli/exit.ts',
  'src/cli/main.ts',
  'src/cli/safe.ts',
  'src/cli/switch.ts',
  'src/cli/withdraw.ts',
  'src/service/domain/request/send-request.ts',
  'src/service/domain/safe/index.ts',
  'src/model/commander.ts',
  'src/model/ledger.ts',
  'src/ports/broadcast-strategy.interface.ts',
  'src/ports/signer.interface.ts',
  'src/ports/slot-timing.interface.ts'
]);

const USAGE = `Usage:
  bun run scripts/lint/coverage-diff.ts [--report <path>]

Runs \`bun test --coverage\` (or reads the report from <path>) and lists every
source file under src/ that is missing from the coverage report.

Bun only instruments files that are imported by a test. Files without a test
(and not transitively imported) silently vanish from the report — this script
surfaces them.

Options:
  --report <path>   Read the coverage report from a file instead of running the
                    test suite. The file must contain the default text report
                    produced by \`bun test --coverage\`.
  -h, --help        Show this message.
`;

interface DiffOptions {
  reportPath: string | null;
}

function parseArgs(argv: string[]): DiffOptions {
  const options: DiffOptions = { reportPath: null };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (arg === '--report') {
      const next = argv[index + 1];
      if (!next) {
        process.stderr.write(chalk.red('Error: --report requires a path argument\n'));
        process.exit(2);
      }
      options.reportPath = resolve(next);
      index++;
      continue;
    }
    process.stderr.write(chalk.red(`Error: unknown argument "${arg}"\n`));
    process.stderr.write(USAGE);
    process.exit(2);
  }

  return options;
}

async function collectSourceFiles(): Promise<Set<string>> {
  const glob = new Glob(SOURCE_GLOB);
  const files = new Set<string>();

  for await (const file of glob.scan({ cwd: SRC_DIR, absolute: true })) {
    const relativePath = relative(ROOT, file);
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      continue;
    }
    if (INTENTIONAL_EXCLUDES.has(relativePath)) {
      continue;
    }
    files.add(relativePath);
  }

  return files;
}

async function loadReport(reportPath: string | null): Promise<string> {
  if (reportPath) {
    if (!existsSync(reportPath)) {
      process.stderr.write(chalk.red(`Error: coverage report not found at ${reportPath}\n`));
      process.exit(1);
    }
    return await Bun.file(reportPath).text();
  }

  process.stderr.write(chalk.blue('Running `bun test --coverage`...\n'));
  const proc = Bun.spawn(['bun', 'test', '--coverage'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    process.stderr.write(
      chalk.yellow(
        `Warning: \`bun test --coverage\` exited with code ${exitCode}. Parsing output anyway.\n`
      )
    );
  }

  return stdout + '\n' + stderr;
}

function parseReportedFiles(report: string): Set<string> {
  const reported = new Set<string>();
  const lineRegex = /^\s(src\/\S+\.ts)\s/;

  for (const line of report.split('\n')) {
    const match = lineRegex.exec(line);
    if (match && match[1]) {
      reported.add(match[1]);
    }
  }

  return reported;
}

function printResult(allFiles: Set<string>, reportedFiles: Set<string>): void {
  const missing = [...allFiles].filter((file) => !reportedFiles.has(file)).sort();
  const unexpected = [...reportedFiles]
    .filter((file) => !allFiles.has(file) && !INTENTIONAL_EXCLUDES.has(file))
    .sort();

  const total = allFiles.size;
  const covered = total - missing.length;
  const percentage = total === 0 ? 0 : (covered / total) * 100;

  process.stdout.write(chalk.bold('\nCoverage file presence report\n'));
  process.stdout.write(`  Source files under src/: ${total}\n`);
  process.stdout.write(`  Files in coverage report: ${reportedFiles.size}\n`);
  process.stdout.write(`  Intentionally excluded: ${INTENTIONAL_EXCLUDES.size}\n`);
  process.stdout.write(`  Files missing from report: ${missing.length}\n`);
  process.stdout.write(`  Presence: ${percentage.toFixed(2)}%\n\n`);

  if (missing.length > 0) {
    process.stdout.write(chalk.red.bold(`Missing from coverage report (${missing.length}):\n`));
    for (const file of missing) {
      process.stdout.write(`  - ${file}\n`);
    }
    process.stdout.write('\n');
  } else {
    process.stdout.write(chalk.green('All source files appear in the coverage report.\n\n'));
  }

  if (unexpected.length > 0) {
    process.stdout.write(
      chalk.yellow.bold(`Reported files not found on disk under src/ (${unexpected.length}):\n`)
    );
    for (const file of unexpected) {
      process.stdout.write(`  - ${file}\n`);
    }
    process.stdout.write('\n');
  }

  process.exit(missing.length === 0 ? 0 : 1);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [allFiles, report] = await Promise.all([
    collectSourceFiles(),
    loadReport(options.reportPath)
  ]);
  const reportedFiles = parseReportedFiles(report);
  printResult(allFiles, reportedFiles);
}

await main();
