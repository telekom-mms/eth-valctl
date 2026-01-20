# Build and Packaging

Patterns for building and distributing Bun CLI applications as native binaries.

## Native Binary Compilation

### Basic Compilation

```bash
# Compile to native binary
bun build --compile ./src/cli/main.ts --outfile my-cli

# Run the binary
./my-cli --help
```

### Production Build

```bash
# Full production build with optimizations
bun build --compile \
  --minify \
  --bytecode \
  --sourcemap \
  ./src/cli/main.ts \
  --outfile my-cli
```

| Flag | Purpose |
|------|---------|
| `--compile` | Create standalone executable |
| `--minify` | Minify code for smaller binary |
| `--bytecode` | Compile to bytecode for faster startup |
| `--sourcemap` | Include source maps for debugging |

### Cross-Platform Compilation

```bash
# Linux x64
bun build --compile --target=bun-linux-x64 ./src/cli/main.ts --outfile dist/my-cli-linux-x64

# Linux ARM64
bun build --compile --target=bun-linux-arm64 ./src/cli/main.ts --outfile dist/my-cli-linux-arm64

# macOS x64
bun build --compile --target=bun-darwin-x64 ./src/cli/main.ts --outfile dist/my-cli-darwin-x64

# macOS ARM64 (Apple Silicon)
bun build --compile --target=bun-darwin-arm64 ./src/cli/main.ts --outfile dist/my-cli-darwin-arm64

# Windows x64
bun build --compile --target=bun-windows-x64 ./src/cli/main.ts --outfile dist/my-cli-win-x64.exe
```

### Build-Time Constants

```bash
# Inject version and build info
bun build --compile \
  --define 'VERSION="1.2.3"' \
  --define 'BUILD_TIME="2025-01-15T12:00:00Z"' \
  --define 'COMMIT_HASH="abc123"' \
  ./src/cli/main.ts \
  --outfile my-cli
```

```typescript
// Access in code (declared globally)
declare const VERSION: string;
declare const BUILD_TIME: string;
declare const COMMIT_HASH: string;

console.log(`Version: ${VERSION}`);
console.log(`Built: ${BUILD_TIME}`);
console.log(`Commit: ${COMMIT_HASH}`);
```

## Package.json Scripts

### Development Scripts

```json
{
  "scripts": {
    "start": "bun run src/cli/main.ts",
    "dev": "bun --watch run src/cli/main.ts",
    "format": "bunx prettier --write .",
    "format:check": "bunx prettier --check .",
    "lint": "bunx eslint . --ext .ts --fix",
    "typecheck": "bun run --bun tsc --noEmit",
    "test": "bun test",
    "test:coverage": "bun test --coverage"
  }
}
```

### Build Scripts

```json
{
  "scripts": {
    "clean": "rm -rf dist bin",
    "build": "bun run clean && bun build --compile --minify --bytecode ./src/cli/main.ts --outfile bin/my-cli",
    "build:dev": "bun build --compile ./src/cli/main.ts --outfile bin/my-cli",

    "package": "bun run build:all",
    "build:all": "bun run build:linux && bun run build:macos && bun run build:windows",

    "build:linux": "bun build --compile --minify --bytecode --target=bun-linux-x64 ./src/cli/main.ts --outfile dist/my-cli-linux-x64",
    "build:linux-arm": "bun build --compile --minify --bytecode --target=bun-linux-arm64 ./src/cli/main.ts --outfile dist/my-cli-linux-arm64",
    "build:macos": "bun build --compile --minify --bytecode --target=bun-darwin-arm64 ./src/cli/main.ts --outfile dist/my-cli-darwin-arm64",
    "build:macos-x64": "bun build --compile --minify --bytecode --target=bun-darwin-x64 ./src/cli/main.ts --outfile dist/my-cli-darwin-x64",
    "build:windows": "bun build --compile --minify --bytecode --target=bun-windows-x64 ./src/cli/main.ts --outfile dist/my-cli-win-x64.exe"
  }
}
```

> **Note:** Projects with native dependencies (e.g., `@chainsafe/blst`) may use a custom packaging script instead of explicit build targets. See `scripts/package/package.ts` for an example that handles cross-platform dependency installation before compilation.

### CI/CD Integration

```json
{
  "scripts": {
    "ci": "bun run lint && bun run typecheck && bun run test",
    "ci:build": "bun run ci && bun run build:all",
    "smoke": "./bin/my-cli --version && ./bin/my-cli --help"
  }
}
```

## Directory Structure

### Source Layout

```
project/
├── src/
│   ├── cli/
│   │   ├── main.ts          # Entry point
│   │   └── commands/        # Subcommands
│   ├── service/
│   ├── model/
│   └── constants/
├── bin/                     # Local dev binary (gitignored)
├── dist/                    # Release binaries (gitignored)
├── package.json
├── tsconfig.json
└── bun.lock
```

### .gitignore

```gitignore
# Dependencies
node_modules/

# Build outputs
bin/
dist/
*.exe

# Bun
bun.lockb

# Environment
.env
.env.local
.env.*.local

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

## Dependency Management

### Package.json Best Practices

```json
{
  "name": "my-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "my-cli": "./bin/my-cli"
  },
  "engines": {
    "bun": ">=1.2.0"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "chalk": "^5.6.0",
    "prompts": "^2.4.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/prompts": "^2.4.9",
    "eslint": "^9.0.0",
    "typescript": "^5.9.0"
  }
}
```

### Lock File

```bash
# Always commit bun.lockb for reproducible builds
git add bun.lockb

# Update dependencies
bun update

# Install exact versions from lockfile
bun install --frozen-lockfile  # Use in CI
```

### Security Audits

```bash
# List all dependencies
bun pm ls --all

# Check for outdated packages
bun outdated

# Update specific package
bun update commander
```

## CI/CD Pipeline

### GitHub Actions Example

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: bun-linux-x64
            binary: my-cli-linux-x64
          - os: ubuntu-latest
            target: bun-linux-arm64
            binary: my-cli-linux-arm64
          - os: macos-latest
            target: bun-darwin-arm64
            binary: my-cli-darwin-arm64
          - os: macos-latest
            target: bun-darwin-x64
            binary: my-cli-darwin-x64
          - os: ubuntu-latest
            target: bun-windows-x64
            binary: my-cli-win-x64.exe

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run tests
        run: bun test

      - name: Build binary
        run: |
          bun build --compile --minify --bytecode \
            --target=${{ matrix.target }} \
            ./src/cli/main.ts \
            --outfile dist/${{ matrix.binary }}

      - name: Smoke test
        if: matrix.target != 'bun-windows-x64'
        run: |
          chmod +x dist/${{ matrix.binary }}
          ./dist/${{ matrix.binary }} --version

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.binary }}
          path: dist/${{ matrix.binary }}

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/**/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Build Verification

### Smoke Tests

```typescript
// scripts/smoke-test.ts
import { $ } from 'bun';

async function smokeTest(): Promise<void> {
  const binary = './bin/my-cli';

  // Test version flag
  const version = await $`${binary} --version`.text();
  if (!version.includes('1.')) {
    throw new Error('Version check failed');
  }

  // Test help flag
  const help = await $`${binary} --help`.text();
  if (!help.includes('Usage:')) {
    throw new Error('Help check failed');
  }

  // Test basic command
  const result = await $`${binary} validate --help`.text();
  if (!result.includes('validate')) {
    throw new Error('Command check failed');
  }

  console.log('All smoke tests passed');
}

smokeTest().catch((error) => {
  console.error('Smoke test failed:', error);
  process.exit(1);
});
```

### Reproducible Builds

```bash
# Ensure consistent builds across machines
# 1. Pin Bun version
echo "1.2.0" > .bun-version

# 2. Use frozen lockfile
bun install --frozen-lockfile

# 3. Clean before build
rm -rf dist bin

# 4. Build
bun build --compile ...
```

## Binary Distribution

### Archive Creation

```bash
# Create tar.gz archives for distribution
cd dist
tar -czvf my-cli-linux-x64.tar.gz my-cli-linux-x64
tar -czvf my-cli-darwin-arm64.tar.gz my-cli-darwin-arm64

# Windows zip
zip my-cli-win-x64.zip my-cli-win-x64.exe
```

### Checksums

```bash
# Generate checksums
sha256sum dist/*.tar.gz dist/*.zip > dist/checksums.txt

# Verify download
sha256sum -c checksums.txt
```

### macOS Code Signing

```xml
<!-- scripts/package/macos-entitlements.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
</dict>
</plist>
```

```bash
# Sign for macOS (required for distribution)
codesign --sign - --force --entitlements scripts/package/macos-entitlements.plist dist/my-cli-darwin-arm64
```
