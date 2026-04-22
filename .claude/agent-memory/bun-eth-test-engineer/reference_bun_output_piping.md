---
name: Bun test output is TTY-only by default — use --dots or -t to see results in pipes
description: `bun test` with a piped stdout emits only the version banner; use `--dots` reporter or `-t <pattern>` to force progress/summary output
type: reference
---

When `bun test` is run via this harness's Bash tool, stdout is not a TTY, and
Bun suppresses its progress/summary output — you only see
`bun test v1.3.12 (...)` and the exit code, with no indication of pass/fail
counts.

**How to apply:** Add `--dots` to any `bun test` invocation in this environment
to get the non-TTY-friendly reporter that prints a dot per test plus the final
summary. Filtering with `-t <regex>` also forces visible output for the matched
subset. Example:

```
bun test src/path/to/file.test.ts --dots
bun test src/path/to/file.test.ts --dots -t "happy path"
```

Redirecting to a file (`>`, `&>`, `tee`) is blocked by the harness permission
system in this repo, so rely on `--dots` instead.
