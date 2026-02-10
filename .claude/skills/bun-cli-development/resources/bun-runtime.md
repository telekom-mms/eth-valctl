# Bun Runtime Patterns

Detailed patterns for using Bun's native APIs effectively.

## Bun Native APIs

### Prefer Bun APIs Over Node.js

Use Bun's native APIs for better performance and type safety:

| Task | Bun API | Node.js Equivalent |
|------|---------|-------------------|
| Read file | `Bun.file()` | `fs.readFileSync()` |
| Write file | `Bun.write()` | `fs.writeFileSync()` |
| Spawn process | `Bun.spawn()` | `child_process.spawn()` |
| HTTP server | `Bun.serve()` | `http.createServer()` |
| Hash data | `Bun.hash()` | `crypto.createHash()` |

### File Operations

```typescript
// Reading files
const file = Bun.file('./config.json');
const content = await file.text();
const json = await file.json();
const bytes = await file.bytes();

// Check if file exists
const exists = await file.exists();

// File metadata
console.log(file.size);
console.log(file.type); // MIME type

// Writing files (atomic)
await Bun.write('./output.txt', 'Hello, World!');
await Bun.write('./data.json', JSON.stringify(data, null, 2));

// Write with options
await Bun.write('./output.txt', content, {
  mode: 0o644,
});
```

### Process Spawning

```typescript
// Simple spawn
const proc = Bun.spawn(['ls', '-la']);
await proc.exited;

// Capture output
const proc = Bun.spawn(['git', 'status']);
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
const exitCode = await proc.exited;

// Spawn with options
const proc = Bun.spawn(['npm', 'install'], {
  cwd: '/path/to/project',
  env: { ...process.env, NODE_ENV: 'production' },
  stdout: 'pipe',
  stderr: 'pipe',
});

// Streaming output
const proc = Bun.spawn(['long-running-command']);
const reader = proc.stdout.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

### Environment Variables

```typescript
// Access environment variables
const apiKey = process.env.API_KEY;
const nodeEnv = process.env.NODE_ENV ?? 'development';

// Bun automatically loads .env files
// .env, .env.local, .env.development, .env.production

// Validate required environment variables at startup
function validateEnv(): void {
  const required = ['API_KEY', 'DATABASE_URL'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}
```

## Process Lifecycle

### Signal Handling

```typescript
// Handle graceful shutdown
let isShuttingDown = false;

function shutdown(signal: string, code: number): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(`\nReceived ${signal}, shutting down gracefully...`);

  // Cleanup operations
  cleanup().finally(() => {
    process.exit(code);
  });

  // Force exit after timeout
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(code);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT', 130));
process.on('SIGTERM', () => shutdown('SIGTERM', 143));
```

### Uncaught Error Handling

```typescript
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
```

## Async Patterns

### Promise Error Handling

```typescript
// Always handle promise rejections
async function fetchData(): Promise<Data> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError('Network request failed');
    }
    throw error;
  }
}
```

### Timeout Handling

```typescript
// Using AbortController for timeouts
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Usage
try {
  const response = await fetchWithTimeout('https://api.example.com', 5000);
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('Request timed out');
  }
}
```

### Concurrency Control

```typescript
// Process items with concurrency limit
async function processWithLimit<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  limit: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then((result) => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// Usage: Process 100 items, max 10 concurrent
await processWithLimit(items, processItem, 10);
```

### Resource Cleanup

```typescript
// Using try/finally for cleanup
async function withConnection<T>(
  fn: (conn: Connection) => Promise<T>
): Promise<T> {
  const conn = await createConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

// Multiple resources
async function processFiles(): Promise<void> {
  const inputFile = Bun.file('./input.txt');
  const outputHandle = await Bun.write('./output.txt', '');

  try {
    const content = await inputFile.text();
    const processed = processContent(content);
    await Bun.write('./output.txt', processed);
  } catch (error) {
    // Cleanup on error
    await Bun.write('./output.txt', ''); // Clear partial output
    throw error;
  }
}
```

## Performance Optimization

### Lazy Loading

```typescript
// Lazy load expensive modules
let expensiveModule: typeof import('./expensive') | undefined;

async function getExpensiveModule() {
  if (!expensiveModule) {
    expensiveModule = await import('./expensive');
  }
  return expensiveModule;
}
```

### Streaming Large Data

```typescript
// Stream large files instead of loading into memory
async function processLargeFile(path: string): Promise<void> {
  const file = Bun.file(path);
  const stream = file.stream();
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Process chunk
    await processChunk(value);
  }
}
```

### Memory-Efficient Caching

```typescript
// Use WeakMap for object caches (allows GC)
const cache = new WeakMap<object, ProcessedData>();

function getOrCompute(key: object): ProcessedData {
  let data = cache.get(key);
  if (!data) {
    data = expensiveComputation(key);
    cache.set(key, data);
  }
  return data;
}

// TTL cache for string keys
const ttlCache = new Map<string, { data: unknown; expires: number }>();

function getCached<T>(key: string, ttlMs: number, compute: () => T): T {
  const cached = ttlCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }

  const data = compute();
  ttlCache.set(key, { data, expires: Date.now() + ttlMs });
  return data;
}
```

## Module Patterns

### ESM-Only

```typescript
// Always use ESM imports
import { something } from './module';
import type { SomeType } from './types';

// Named exports preferred
export function myFunction(): void {}
export const myConstant = 42;

// Avoid default exports (except for single-purpose modules)
```

### Barrel Files

```typescript
// src/service/index.ts - Re-export public API
export { ValidatorService } from './validator-service';
export { NetworkService } from './network-service';
export type { ValidatorConfig } from './types';

// Don't export internal implementation details
```

### Circular Dependency Prevention

```typescript
// Bad: circular dependency
// a.ts imports from b.ts
// b.ts imports from a.ts

// Good: extract shared types/interfaces
// types.ts - shared types
// a.ts imports from types.ts
// b.ts imports from types.ts
```
