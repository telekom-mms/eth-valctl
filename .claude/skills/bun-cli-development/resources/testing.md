# Testing Patterns

Comprehensive testing patterns for Bun CLI applications using bun:test.

## Test Framework

### Basic Setup

```typescript
import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll, mock, spyOn } from 'bun:test';
```

### Test File Naming

| Pattern | Purpose |
|---------|---------|
| `*.test.ts` | Unit tests |
| `*.spec.ts` | Alternative unit test convention |
| `tests/integration/*.test.ts` | Integration tests |
| `tests/e2e/*.test.ts` | End-to-end tests |

### Running Tests

```bash
# Run all tests
bun test

# Run specific file
bun test src/service/validator.test.ts

# Run tests matching pattern
bun test --grep "validator"

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

## Test Organization

### Describe Blocks

```typescript
import { describe, test, expect } from 'bun:test';

describe('ValidatorService', () => {
  describe('validate', () => {
    test('should accept valid pubkey', () => {
      // ...
    });

    test('should reject invalid pubkey', () => {
      // ...
    });
  });

  describe('consolidate', () => {
    test('should consolidate multiple validators', () => {
      // ...
    });
  });
});
```

### Arrange-Act-Assert Pattern

```typescript
test('should calculate correct fee', () => {
  // Arrange
  const amount = 1000n;
  const feeRate = 10n; // 1%

  // Act
  const fee = calculateFee(amount, feeRate);

  // Assert
  expect(fee).toBe(10n);
});
```

## Async Testing

### Async/Await

```typescript
test('should fetch validator data', async () => {
  const validator = await fetchValidator('0x1234...');

  expect(validator.status).toBe('active');
  expect(validator.balance).toBeGreaterThan(0n);
});
```

### Timeout Configuration

```typescript
// Set timeout for slow tests
test('should complete network request', async () => {
  const result = await slowNetworkOperation();
  expect(result).toBeDefined();
}, 10000); // 10 second timeout

// Or use test.setTimeout
test.setTimeout(30000); // 30 seconds for all tests in file
```

## Mocking

### Mock Functions

```typescript
import { mock, expect, test } from 'bun:test';

test('should call callback with result', () => {
  const callback = mock((value: number) => value * 2);

  processItems([1, 2, 3], callback);

  expect(callback).toHaveBeenCalledTimes(3);
  expect(callback).toHaveBeenCalledWith(1);
  expect(callback).toHaveBeenCalledWith(2);
  expect(callback).toHaveBeenCalledWith(3);
});
```

### Spying on Methods

```typescript
import { spyOn, expect, test } from 'bun:test';

test('should log errors', () => {
  const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});

  handleError(new Error('test error'));

  expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test error'));

  consoleSpy.mockRestore();
});
```

### Mock Modules

```typescript
import { mock, expect, test } from 'bun:test';

// Mock fetch
const mockFetch = mock(async () => ({
  ok: true,
  json: async () => ({ data: 'test' }),
}));

globalThis.fetch = mockFetch as typeof fetch;

test('should fetch data', async () => {
  const result = await fetchData();

  expect(mockFetch).toHaveBeenCalled();
  expect(result.data).toBe('test');
});
```

### Mock Cleanup

```typescript
import { beforeEach, afterEach, mock } from 'bun:test';

let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetch = mock(async () => ({ ok: true, json: async () => ({}) }));
  globalThis.fetch = mockFetch as typeof fetch;
});

afterEach(() => {
  mockFetch.mockClear();
});
```

## CLI Testing

### Testing Exit Codes

```typescript
import { test, expect } from 'bun:test';

test('should exit with 0 on success', async () => {
  const proc = Bun.spawn(['./bin/my-cli', 'validate', '--help']);
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});

test('should exit with 2 on invalid args', async () => {
  const proc = Bun.spawn(['./bin/my-cli', '--invalid-flag']);
  const exitCode = await proc.exited;

  expect(exitCode).toBe(2);
});

test('should exit with 1 on error', async () => {
  const proc = Bun.spawn(['./bin/my-cli', 'process', '--file', 'nonexistent.txt']);
  const exitCode = await proc.exited;

  expect(exitCode).toBe(1);
});
```

### Testing stdout/stderr

```typescript
import { test, expect } from 'bun:test';

test('should output version to stdout', async () => {
  const proc = Bun.spawn(['./bin/my-cli', '--version']);
  const stdout = await new Response(proc.stdout).text();

  expect(stdout).toMatch(/\d+\.\d+\.\d+/);
});

test('should output errors to stderr', async () => {
  const proc = Bun.spawn(['./bin/my-cli', 'process', '--invalid']);
  const stderr = await new Response(proc.stderr).text();

  expect(stderr).toContain('Error');
  expect(stderr).toContain('invalid');
});
```

### Testing with Input

```typescript
import { test, expect } from 'bun:test';

test('should process stdin input', async () => {
  const input = JSON.stringify({ items: [1, 2, 3] });

  const proc = Bun.spawn(['./bin/my-cli', 'process'], {
    stdin: new TextEncoder().encode(input),
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stdout).toContain('processed');
});
```

## Test Isolation

### Setup and Teardown

```typescript
import { describe, test, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';

describe('DatabaseService', () => {
  let testDb: Database;

  beforeAll(async () => {
    // Setup once for all tests
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    // Cleanup after all tests
    await testDb.close();
  });

  beforeEach(async () => {
    // Reset before each test
    await testDb.clear();
  });

  afterEach(() => {
    // Cleanup after each test
  });
});
```

### Isolated Test Data

```typescript
// Factory function for test data
function createTestValidator(overrides: Partial<Validator> = {}): Validator {
  return {
    pubkey: `0x${'a'.repeat(96)}`,
    status: 'active',
    balance: 32000000000n,
    ...overrides,
  };
}

test('should process active validator', () => {
  const validator = createTestValidator({ status: 'active' });
  const result = processValidator(validator);
  expect(result.processed).toBe(true);
});

test('should skip exited validator', () => {
  const validator = createTestValidator({ status: 'exited' });
  const result = processValidator(validator);
  expect(result.processed).toBe(false);
});
```

## Assertions

### Basic Assertions

```typescript
// Equality
expect(value).toBe(expected);          // Strict equality (===)
expect(value).toEqual(expected);       // Deep equality
expect(value).not.toBe(unexpected);

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeDefined();
expect(value).toBeUndefined();
expect(value).toBeNull();

// Numbers
expect(value).toBeGreaterThan(5);
expect(value).toBeGreaterThanOrEqual(5);
expect(value).toBeLessThan(10);
expect(value).toBeCloseTo(0.3, 5);     // Floating point

// Strings
expect(str).toContain('substring');
expect(str).toMatch(/pattern/);
expect(str).toStartWith('prefix');
expect(str).toEndWith('suffix');

// Arrays
expect(arr).toContain(item);
expect(arr).toHaveLength(3);

// Objects
expect(obj).toHaveProperty('key');
expect(obj).toHaveProperty('key', 'value');
expect(obj).toMatchObject({ key: 'value' });
```

### Error Assertions

```typescript
// Sync errors
expect(() => throwingFunction()).toThrow();
expect(() => throwingFunction()).toThrow('specific message');
expect(() => throwingFunction()).toThrow(CustomError);

// Async errors
await expect(asyncThrowingFunction()).rejects.toThrow();
await expect(asyncThrowingFunction()).rejects.toThrow('message');
```

### Custom Matchers

```typescript
// Check if value is valid pubkey
expect.extend({
  toBeValidPubkey(received: string) {
    const pass = /^0x[a-fA-F0-9]{96}$/.test(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid pubkey`
          : `expected ${received} to be a valid pubkey`,
    };
  },
});

// Usage
expect('0x' + 'a'.repeat(96)).toBeValidPubkey();
```

## Test Coverage

### Running Coverage

```bash
# Run with coverage
bun test --coverage

# Coverage with thresholds
bun test --coverage --coverageThreshold '{"line": 80, "function": 80}'
```

### Coverage Configuration

```json
// bunfig.toml
[test]
coverage = true
coverageReporters = ["text", "lcov"]
coverageThreshold = { lines = 80, functions = 80, branches = 70 }
```

## Integration Tests

### Network Mocking

```typescript
import { test, expect, beforeAll, afterAll } from 'bun:test';

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith('/validator')) {
        return Response.json({ status: 'active' });
      }
      return new Response('Not found', { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop();
});

test('should fetch validator from API', async () => {
  const response = await fetch(`http://localhost:${server.port}/validator`);
  const data = await response.json();

  expect(data.status).toBe('active');
});
```

### File System Testing

```typescript
import { test, expect, afterEach } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';

const testDir = join(tmpdir(), 'my-cli-test');

afterEach(async () => {
  // Clean up test files
  try {
    await Bun.write(join(testDir, '.cleanup'), '');
    await $`rm -rf ${testDir}`;
  } catch {
    // Ignore cleanup errors
  }
});

test('should write config file', async () => {
  const configPath = join(testDir, 'config.json');

  await writeConfig(configPath, { setting: 'value' });

  const content = await Bun.file(configPath).json();
  expect(content.setting).toBe('value');
});
```

## Parallel Safety

### Unique Test Resources

```typescript
import { randomUUID } from 'crypto';

test('should create unique database', async () => {
  const dbName = `test_${randomUUID()}`;
  const db = await createDatabase(dbName);

  try {
    // Test database operations
    await db.insert({ id: 1 });
    const result = await db.get(1);
    expect(result).toBeDefined();
  } finally {
    await db.drop();
  }
});
```

### Port Allocation

```typescript
// Use port 0 to get random available port
const server = Bun.serve({
  port: 0, // Bun assigns random available port
  fetch() {
    return new Response('OK');
  },
});

console.log(`Server running on port ${server.port}`);
```
