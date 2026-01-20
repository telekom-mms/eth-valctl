# TypeScript Patterns for Bun

Strict TypeScript patterns for type-safe CLI development.

## Compiler Configuration

### Strict Mode Required

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

### Bun-Specific Settings

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "lib": ["ESNext"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

## Type Safety Patterns

### Never Use `any`

```typescript
// Bad
function process(data: any): any {
  return data.value;
}

// Good - use unknown for truly dynamic data
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return String(data.value);
  }
  throw new Error('Invalid data');
}

// Good - use generics for flexible types
function process<T extends { value: string }>(data: T): string {
  return data.value;
}
```

### Type Guards

```typescript
// Type predicate
function isValidatorResponse(data: unknown): data is ValidatorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'pubkey' in data &&
    typeof data.pubkey === 'string'
  );
}

// Usage
if (isValidatorResponse(response)) {
  console.log(response.pubkey); // TypeScript knows this is string
}

// Discriminated union guard
type Result = { success: true; data: string } | { success: false; error: Error };

function handleResult(result: Result): void {
  if (result.success) {
    console.log(result.data); // TypeScript knows data exists
  } else {
    console.error(result.error); // TypeScript knows error exists
  }
}
```

### Branded Types

```typescript
// Create branded types for domain-specific values
declare const ValidatorPubkeyBrand: unique symbol;
type ValidatorPubkey = string & { readonly [ValidatorPubkeyBrand]: never };

declare const GweiBrand: unique symbol;
type Gwei = bigint & { readonly [GweiBrand]: never };

// Factory functions with validation
function createValidatorPubkey(value: string): ValidatorPubkey {
  if (!value.match(/^0x[a-fA-F0-9]{96}$/)) {
    throw new Error('Invalid validator pubkey format');
  }
  return value as ValidatorPubkey;
}

function createGwei(value: bigint): Gwei {
  if (value < 0n) {
    throw new Error('Gwei cannot be negative');
  }
  return value as Gwei;
}

// Now TypeScript prevents mixing up types
function consolidate(source: ValidatorPubkey, target: ValidatorPubkey): void {
  // Can't accidentally pass a regular string
}
```

### Readonly for Immutability

```typescript
// Immutable configuration
interface NetworkConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly beaconUrl: string;
}

// Immutable arrays
function processItems(items: readonly string[]): void {
  // items.push('x'); // Error: cannot modify readonly array
}

// Deep readonly
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

## Discriminated Unions

### State Modeling

```typescript
// Model validator states as discriminated union
type ValidatorState =
  | { status: 'pending'; depositTime: Date }
  | { status: 'active'; activationEpoch: number; balance: bigint }
  | { status: 'exiting'; exitEpoch: number }
  | { status: 'exited'; withdrawableEpoch: number };

// Exhaustive handling
function getStatusMessage(state: ValidatorState): string {
  switch (state.status) {
    case 'pending':
      return `Pending since ${state.depositTime}`;
    case 'active':
      return `Active with balance ${state.balance}`;
    case 'exiting':
      return `Exiting at epoch ${state.exitEpoch}`;
    case 'exited':
      return `Exited, withdrawable at ${state.withdrawableEpoch}`;
  }
  // TypeScript ensures all cases are handled
}
```

### Result Types

```typescript
// Result type for error handling
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// Usage
async function fetchValidator(
  pubkey: string
): Promise<Result<Validator, FetchError>> {
  try {
    const response = await fetch(`/validator/${pubkey}`);
    if (!response.ok) {
      return {
        success: false,
        error: new FetchError(`HTTP ${response.status}`),
      };
    }
    return { success: true, data: await response.json() };
  } catch (error) {
    return {
      success: false,
      error: new FetchError('Network error', { cause: error }),
    };
  }
}

// Caller handles both cases
const result = await fetchValidator(pubkey);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.error.message);
}
```

## Utility Types

### Built-in Utilities

```typescript
// Partial - all properties optional
type PartialConfig = Partial<Config>;

// Required - all properties required
type RequiredConfig = Required<Config>;

// Pick - select properties
type NameOnly = Pick<User, 'name' | 'email'>;

// Omit - exclude properties
type UserWithoutId = Omit<User, 'id'>;

// Record - object with specific key/value types
type NetworkConfigs = Record<string, NetworkConfig>;

// Readonly - make all properties readonly
type ImmutableConfig = Readonly<Config>;

// NonNullable - remove null/undefined
type DefiniteString = NonNullable<string | null | undefined>;
```

### Custom Utility Types

```typescript
// Make specific properties required
type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Make specific properties optional
type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Extract function parameter types
type FirstParam<T extends (...args: unknown[]) => unknown> = Parameters<T>[0];

// Extract return type
type ReturnOf<T extends (...args: unknown[]) => unknown> = ReturnType<T>;
```

## Generic Patterns

### Constrained Generics

```typescript
// Constrain to objects with id
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}

// Constrain to specific keys
function pluck<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Multiple constraints
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}
```

### Generic Classes

```typescript
// Generic service class
class Repository<T extends { id: string }> {
  private items: Map<string, T> = new Map();

  add(item: T): void {
    this.items.set(item.id, item);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }
}

// Usage
interface Validator {
  id: string;
  pubkey: string;
  balance: bigint;
}

const validatorRepo = new Repository<Validator>();
```

## Error Handling

### Custom Error Classes

```typescript
// Base error with code
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific errors
class ValidationError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'VALIDATION_ERROR', cause);
  }
}

class NetworkError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'NETWORK_ERROR', cause);
  }
}

// Usage
function validatePubkey(pubkey: string): void {
  if (!pubkey.match(/^0x[a-fA-F0-9]{96}$/)) {
    throw new ValidationError(`Invalid pubkey format: ${pubkey}`);
  }
}
```

### Error Type Narrowing

```typescript
// Type-safe error handling
async function handleOperation(): Promise<void> {
  try {
    await riskyOperation();
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`Validation failed: ${error.message}`);
      process.exit(2);
    }

    if (error instanceof NetworkError) {
      console.error(`Network error: ${error.message}`);
      // Retry logic
    }

    // Unknown error
    if (error instanceof Error) {
      console.error(`Unexpected error: ${error.message}`);
    } else {
      console.error('Unknown error occurred');
    }

    process.exit(1);
  }
}
```

## Import Patterns

### Type-Only Imports

```typescript
// Import only types (removed at compile time)
import type { Validator, NetworkConfig } from './types';

// Mixed import
import { fetchValidator, type ValidatorResponse } from './api';
```

### Namespace Imports

```typescript
// Import all as namespace
import * as utils from './utils';

utils.formatAmount(amount);
utils.validatePubkey(pubkey);
```

### Re-exports

```typescript
// Re-export everything
export * from './validators';

// Re-export specific items
export { ValidatorService, type ValidatorConfig } from './validators';

// Re-export with rename
export { OldName as NewName } from './module';
```
