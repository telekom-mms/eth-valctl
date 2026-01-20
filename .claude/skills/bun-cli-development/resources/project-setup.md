# Project Setup

Patterns for setting up and configuring Bun/TypeScript projects.

## TypeScript Configuration

### tsconfig.json for Bun

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "allowImportingTsExtensions": true,
    "noEmit": true,

    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,

    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,

    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,

    "paths": {
      "@/*": ["./src/*"],
      "@config/*": ["./src/config/*"],
      "@service/*": ["./src/service/*"],
      "@model/*": ["./src/model/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Key Settings Explained

| Setting | Value | Purpose |
|---------|-------|---------|
| target | ESNext | Bun supports modern JS natively |
| moduleResolution | bundler | Modern import resolution |
| types | bun-types | Bun API type definitions |
| strict | true | Full type safety |
| noUncheckedIndexedAccess | true | Safer array/object access |

## Bun Configuration

### bunfig.toml

```toml
[install]
# Use faster registry if available
registry = "https://registry.npmjs.org"

[install.cache]
# Cache location
dir = "~/.bun/install/cache"

[test]
# Test configuration
preload = ["./tests/setup.ts"]
coverage = true
coverageDir = "./coverage"

[run]
# Silent mode for scripts
silent = false
```

## package.json Structure

### Essential Fields

```json
{
  "name": "my-cli",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/cli/main.ts",
  "bin": {
    "my-cli": "./src/cli/main.ts"
  },
  "engines": {
    "bun": ">=1.0.0"
  },
  "scripts": {
    "start": "bun run src/cli/main.ts",
    "dev": "bun --watch src/cli/main.ts",
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
    "clean": "rm -rf dist my-cli coverage"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

## Directory Structure

### Recommended Layout

```
project/
├── src/
│   ├── cli/              # Command definitions
│   │   ├── main.ts       # Entry point, program setup
│   │   ├── command-a.ts  # One file per command
│   │   └── command-b.ts
│   ├── service/          # Business logic
│   │   ├── domain/       # Core operations
│   │   └── validation/   # Input validation
│   ├── model/            # Type definitions
│   │   ├── types.ts
│   │   └── constants.ts
│   ├── config/           # Configuration loading
│   │   └── env.ts        # Environment validation
│   └── constants/        # Static values
├── tests/
│   ├── setup.ts          # Test setup/globals
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── scripts/              # Build/utility scripts
│   └── build.ts
├── package.json
├── tsconfig.json
├── bunfig.toml
├── .gitignore
├── .gitattributes
└── .env.example
```

### Layer Responsibilities

| Layer | Purpose | Dependencies |
|-------|---------|--------------|
| cli/ | Argument parsing, user interaction | service/, model/ |
| service/ | Business logic | model/, config/ |
| model/ | Type definitions | None |
| config/ | Configuration loading | None |
| constants/ | Static values | None |

## File Naming Conventions

### Rules

| Pattern | When to Use | Example |
|---------|-------------|---------|
| kebab-case | All source files | `validator-service.ts` |
| PascalCase | Single class/type exports | `ValidatorIndex.ts` |
| .test.ts | Test files | `validator-service.test.ts` |
| index.ts | Module entry points | `src/service/index.ts` |

### Examples

```
src/
├── cli/
│   ├── main.ts
│   ├── consolidate.ts
│   └── withdraw.ts
├── service/
│   ├── index.ts              # Barrel file
│   ├── validator-service.ts
│   └── domain/
│       ├── consolidate.ts
│       └── withdraw.ts
├── model/
│   ├── index.ts
│   ├── validator.ts
│   └── transaction.ts
```

## Git Configuration

### .gitignore

```gitignore
# Dependencies
node_modules/

# Build output
dist/
*.exe
my-cli

# Bun
bun.lockb

# Coverage
coverage/

# Environment
.env
.env.local

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log
```

### .gitattributes

```gitattributes
# Treat lockfile as binary
bun.lockb binary

# Ensure LF line endings
*.ts text eol=lf
*.json text eol=lf
*.md text eol=lf
```

## Environment Configuration

### .env.example

```bash
# Network Configuration
RPC_URL=https://rpc.example.com
BEACON_URL=https://beacon.example.com

# Optional Settings
DEBUG=false
LOG_LEVEL=info

# Do NOT include secrets here
# Secrets should be prompted at runtime
```

### Environment Validation

```typescript
// src/config/env.ts
interface EnvConfig {
  rpcUrl: string;
  beaconUrl: string;
  debug: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function validateEnv(): EnvConfig {
  const rpcUrl = process.env.RPC_URL;
  const beaconUrl = process.env.BEACON_URL;

  if (!rpcUrl) {
    console.error('Error: RPC_URL environment variable is required');
    process.exit(1);
  }

  if (!beaconUrl) {
    console.error('Error: BEACON_URL environment variable is required');
    process.exit(1);
  }

  return {
    rpcUrl,
    beaconUrl,
    debug: process.env.DEBUG === 'true',
    logLevel: (process.env.LOG_LEVEL as EnvConfig['logLevel']) || 'info',
  };
}

export const config = validateEnv();
```

### Type-Safe Validation with Zod

```typescript
import { z } from 'zod';

const envSchema = z.object({
  RPC_URL: z.string().url(),
  BEACON_URL: z.string().url(),
  DEBUG: z.string().transform(v => v === 'true').default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment configuration:');
    result.error.errors.forEach(err => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }

  return result.data;
}

export const config = validateEnv();
```

## Initial Setup Checklist

When starting a new Bun CLI project:

1. **Initialize project**
   ```bash
   mkdir my-cli && cd my-cli
   bun init
   ```

2. **Install dependencies**
   ```bash
   bun add commander chalk prompts
   bun add -d @types/bun typescript
   ```

3. **Create directory structure**
   ```bash
   mkdir -p src/{cli,service/domain,model,config,constants}
   mkdir -p tests/{unit,integration}
   mkdir scripts
   ```

4. **Configure TypeScript** - Create tsconfig.json (see above)

5. **Configure Bun** - Create bunfig.toml (see above)

6. **Configure Git**
   ```bash
   git init
   # Create .gitignore and .gitattributes
   ```

7. **Create environment template** - Create .env.example

8. **Set up scripts** - Update package.json scripts
