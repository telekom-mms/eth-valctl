# GitHub Workflows Skill

Guidance for creating and maintaining GitHub Actions workflows with CI/CD best practices.

## When to Use This Skill

Use this skill when:
- Creating or modifying GitHub Actions workflows
- Setting up CI/CD pipelines
- Configuring automated testing, linting, or builds
- Implementing release automation
- Working with matrix builds for cross-platform support

## Project Workflow Patterns

This project uses these established workflow patterns:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pre-commit.yaml` | Push to develop/feature/*, PR to main | Validate commits with pre-commit hooks |
| `semantic-release.yaml` | Push to main | Create release tags automatically |
| `release.yaml` | Tag `v*.*.*` | Build cross-platform binaries |

## Workflow Structure

### Basic Template

```yaml
---
name: "Workflow Name"

on:
  push:
    branches:
      - "main"
  pull_request:
    branches:
      - "main"

jobs:
  job-name:
    name: "Human-readable job name"
    runs-on: "ubuntu-latest"
    steps:
      - name: "Checkout"
        uses: "actions/checkout@v4"

      - name: "Setup Node.js"
        uses: "actions/setup-node@v4"
        with:
          node-version: "22"

      - name: "Run task"
        run: "npm run build"
```

### Style Conventions

- Quote all string values in YAML
- Use lowercase with hyphens for job/step IDs
- Descriptive `name` fields for jobs and steps
- Pin action versions (e.g., `@v4` not `@latest`)

## Trigger Patterns

### Branch-Based Triggers

```yaml
on:
  push:
    branches:
      - "main"
      - "develop"
      - "feature/*"
      - "hotfix/*"
  pull_request:
    branches:
      - "main"
```

### Tag-Based Triggers

```yaml
on:
  push:
    tags:
      - "v*.*.*"
```

### Path Filters

```yaml
on:
  push:
    paths:
      - "src/**"
      - "package.json"
    paths-ignore:
      - "**/*.md"
      - "docs/**"
```

## Matrix Builds

Cross-platform builds using matrix strategy:

```yaml
jobs:
  build:
    name: "Build on ${{ matrix.os }}"
    runs-on: "${{ matrix.os }}"
    strategy:
      matrix:
        include:
          - os: "ubuntu-latest"
            target: "linux-x64"
            platform: "linux"
          - os: "macos-latest"
            target: "macos-x64"
            platform: "darwin"
          - os: "windows-latest"
            target: "win-x64"
            platform: "win"
    steps:
      - uses: "actions/checkout@v4"
      - name: "Build for ${{ matrix.platform }}"
        run: "npm run build:${{ matrix.platform }}"
```

## Common Actions

### Checkout

```yaml
- uses: "actions/checkout@v4"
  with:
    fetch-depth: 0  # Full history for semantic-release
```

### Setup Node.js

```yaml
- uses: "actions/setup-node@v4"
  with:
    node-version: "22"
    cache: "npm"  # or "yarn", "pnpm"
```

### Setup Bun

```yaml
- uses: "oven-sh/setup-bun@v2"
  with:
    bun-version: "latest"
```

### Setup Python

```yaml
- uses: "actions/setup-python@v5"
  with:
    python-version: "3.13"
```

### Cache Dependencies

```yaml
- uses: "actions/cache@v4"
  with:
    path: "~/.cache/pre-commit"
    key: "pre-commit-${{ hashFiles('.pre-commit-config.yaml') }}"
    restore-keys: |
      pre-commit-
```

### Upload Artifact

```yaml
- uses: "actions/upload-artifact@v4"
  with:
    name: "build-output"
    path: "dist/"
    retention-days: 5
```

### Download Artifact

```yaml
- uses: "actions/download-artifact@v4"
  with:
    path: "artifacts"
```

### GitHub Release

```yaml
- uses: "softprops/action-gh-release@v2"
  with:
    token: "${{ secrets.GITHUB_TOKEN }}"
    tag_name: "${{ github.ref_name }}"
    generate_release_notes: true
    files: |
      dist/*.tar.gz
      dist/*.zip
```

## Job Dependencies

```yaml
jobs:
  build:
    runs-on: "ubuntu-latest"
    steps:
      - run: "npm run build"

  test:
    needs: "build"
    runs-on: "ubuntu-latest"
    steps:
      - run: "npm test"

  deploy:
    needs: ["build", "test"]
    runs-on: "ubuntu-latest"
    steps:
      - run: "npm run deploy"
```

## Permissions

```yaml
jobs:
  release:
    runs-on: "ubuntu-latest"
    permissions:
      contents: "write"
      issues: "write"
      pull-requests: "write"
    steps:
      - uses: "actions/checkout@v4"
```

## Secrets and Environment Variables

### Using Secrets

```yaml
- name: "Deploy"
  env:
    GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
    DEPLOY_KEY: "${{ secrets.DEPLOY_KEY }}"
  run: "npm run deploy"
```

### Built-in Variables

| Variable | Description |
|----------|-------------|
| `${{ github.ref_name }}` | Branch or tag name |
| `${{ github.sha }}` | Commit SHA |
| `${{ github.event_name }}` | Event type (push, pull_request) |
| `${{ github.repository }}` | Owner/repo |

## Conditional Execution

```yaml
- name: "Only on main"
  if: "github.ref == 'refs/heads/main'"
  run: "npm run deploy"

- name: "Show help on failure"
  if: "failure()"
  run: "echo 'Build failed!'"

- name: "Always run cleanup"
  if: "always()"
  run: "rm -rf temp/"
```

## Shell Configuration

```yaml
- name: "Cross-platform script"
  shell: "bash"
  run: |
    if [ "${{ matrix.platform }}" == "win" ]; then
      echo "Windows build"
    else
      echo "Unix build"
    fi
```

## Git Configuration

For workflows that commit changes:

```yaml
- name: "Configure Git"
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

## Semantic Release Integration

```yaml
jobs:
  release:
    runs-on: "ubuntu-latest"
    steps:
      - uses: "actions/checkout@v4"
        with:
          token: "${{ secrets.PERSONAL_ACCESS_TOKEN }}"
          fetch-depth: 0

      - uses: "actions/setup-node@v4"
        with:
          node-version: "22"

      - name: "Install semantic-release"
        run: |
          npm install semantic-release \
            conventional-changelog-conventionalcommits \
            @semantic-release/git

      - name: "Run Semantic Release"
        env:
          GITHUB_TOKEN: "${{ secrets.PERSONAL_ACCESS_TOKEN }}"
        run: "npx semantic-release"
```

## Pre-commit Validation

```yaml
- name: "Run pre-commit"
  run: |
    pip install pre-commit
    pre-commit run --all-files
```

For commit range validation:

```yaml
- name: "Validate pushed commits"
  run: |
    pre-commit run \
      --from-ref ${{ github.event.before }} \
      --to-ref ${{ github.event.after }} \
      --show-diff-on-failure
```

## Best Practices

1. **Pin action versions** - Use `@v4` not `@latest`
2. **Use caching** - Cache dependencies to speed up builds
3. **Parallel jobs** - Independent jobs run concurrently
4. **Fail fast** - Default for matrix builds
5. **Minimal permissions** - Only request needed permissions
6. **Descriptive names** - Clear job and step names
7. **Error handling** - Use `if: failure()` for cleanup/help
8. **Secrets management** - Never hardcode sensitive values
