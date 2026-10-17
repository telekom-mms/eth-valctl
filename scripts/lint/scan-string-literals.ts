import { Glob } from 'bun';
import { readFileSync } from 'fs';
import { relative } from 'path';

const ROOT = import.meta.dir + '/../..';
const SRC_DIR = ROOT + '/src';

const SKIP_FILE_PATTERNS: RegExp[] = [/\/constants\//, /\.test\.ts$/, /\.d\.ts$/];

const SAFE_LINE_PATTERNS: RegExp[] = [
  /^\s*\/\//,
  /^\s*\*/,
  /^\s*import\s/,
  /^\s*export\s+type\s/,
  /this\.name\s*=/,
  /from\s+'/,
  /@param\s/,
  /@returns/,
  /@throws/,
  /@example/,
  /\.includes\s*\(/,
  /\.startsWith\s*\(/,
  /\.endsWith\s*\(/
];

const COMMANDER_LINE_PATTERNS: RegExp[] = [
  /\.option\s*\(/,
  /\.requiredOption\s*\(/,
  /\.argument\s*\(/,
  /\.addOption\s*\(/,
  /\.description\s*\(/,
  /\.command\s*\(/,
  /\.name\s*\(/,
  /\.version\s*\(/,
  /\.choices\s*\(/,
  /new\s+Option\s*\(/,
  /new\s+Command\s*\(/
];

const PROMPTS_LINE_PATTERNS: RegExp[] = [/message:\s*'/, /title:\s*'/, /name:\s*'/, /type:\s*'/];

const TRIVIAL_VALUES: RegExp[] = [
  /^'hex'$/,
  /^'utf-?8'$/,
  /^'ascii'$/,
  /^'base64'$/,
  /^'string'$/,
  /^'number'$/,
  /^'boolean'$/,
  /^'object'$/,
  /^'undefined'$/,
  /^'function'$/,
  /^'bigint'$/
];

interface Violation {
  file: string;
  line: number;
  literal: string;
  category: 'error-message' | 'log-message' | 'magic-string';
}

function isCommanderContext(lines: string[], index: number): boolean {
  const line = lines[index]!;
  if (COMMANDER_LINE_PATTERNS.some((p) => p.test(line))) return true;

  for (let i = index - 1; i >= Math.max(0, index - 3); i--) {
    const prev = lines[i]!;
    if (COMMANDER_LINE_PATTERNS.some((p) => p.test(prev))) return true;
    if (/^\s*\)/.test(prev) || /^\s*\.\w+\(/.test(prev)) break;
  }
  return false;
}

function isPromptsContext(lines: string[], index: number): boolean {
  const line = lines[index]!;
  if (PROMPTS_LINE_PATTERNS.some((p) => p.test(line))) return true;

  for (let i = index; i >= Math.max(0, index - 5); i--) {
    if (/prompts\s*\(/.test(lines[i]!)) return true;
  }
  return false;
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = relative(ROOT, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (SAFE_LINE_PATTERNS.some((p) => p.test(line))) continue;
    if (/^\s*(type|interface)\s/.test(trimmed)) continue;
    if (isCommanderContext(lines, i)) continue;
    if (isPromptsContext(lines, i)) continue;

    const isErrorThrow = /throw\s+new\s+\w*Error\(/.test(line) || /super\s*\(/.test(line);
    const isConsoleOutput = /console\.(error|log|warn)\(/.test(line);
    const isTemplateLiteral =
      /`[^`]*\$\{[^}]+\}[^`]*`/.test(line) &&
      (isErrorThrow || isConsoleOutput || /throw\s+new\s+\w*Error\(/.test(line));

    const stringMatches = line.matchAll(/(?<!')'([^'\\]|\\.){4,}'(?!')/g);
    for (const match of stringMatches) {
      const literal = match[0];
      if (TRIVIAL_VALUES.some((p) => p.test(literal))) continue;

      const value = literal.slice(1, -1);

      if (isErrorThrow) {
        violations.push({ file: relPath, line: i + 1, literal: value, category: 'error-message' });
      } else if (isConsoleOutput) {
        violations.push({ file: relPath, line: i + 1, literal: value, category: 'log-message' });
      } else if (
        value.includes(' ') &&
        value.length > 15 &&
        !/Buffer\.from|\.toString\(/.test(line)
      ) {
        violations.push({ file: relPath, line: i + 1, literal: value, category: 'magic-string' });
      }
    }

    if (isTemplateLiteral) {
      const templateMatch = line.match(/`([^`]+)`/);
      if (templateMatch) {
        const category = isErrorThrow ? 'error-message' : 'log-message';
        violations.push({ file: relPath, line: i + 1, literal: templateMatch[1]!, category });
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const glob = new Glob('**/*.ts');
  const files: string[] = [];

  for await (const path of glob.scan(SRC_DIR)) {
    const fullPath = SRC_DIR + '/' + path;
    if (SKIP_FILE_PATTERNS.some((p) => p.test(fullPath))) continue;
    files.push(fullPath);
  }

  files.sort();

  let totalViolations = 0;
  const fileViolations: Map<string, Violation[]> = new Map();

  for (const file of files) {
    const violations = scanFile(file);
    if (violations.length > 0) {
      fileViolations.set(relative(ROOT, file), violations);
      totalViolations += violations.length;
    }
  }

  if (totalViolations === 0) {
    console.log('No string literal violations found.');
    process.exit(0);
  }

  const categoryLabels: Record<string, string> = {
    'error-message': '→ logging.ts',
    'log-message': '→ logging.ts',
    'magic-string': '→ application.ts'
  };

  console.error(`Found ${totalViolations} potential string literal violation(s):\n`);

  for (const [file, violations] of fileViolations) {
    console.error(`  ${file}`);
    for (const v of violations) {
      console.error(`    L${v.line} [${categoryLabels[v.category]}]: ${v.literal}`);
    }
    console.error('');
  }

  process.exit(1);
}

main();
