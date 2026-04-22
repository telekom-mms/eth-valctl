---
name: chalk multi-arg calls stringify non-string arguments
description: console.error(chalk.red(msg, err)) produces a single string — asserting the Error object via toContain(errObj) will fail
type: feedback
---

`chalk.red(...args)` concatenates all its arguments into a single string
(same semantics as `console.log` formatting). So
`console.error(chalk.red(BEACON_API_ERROR, error.cause))` emits exactly one
stringified argument like
`"Error while calling beacon API endpoint: Error: ECONNREFUSED 127.0.0.1:5052"`.

**Why:** Discovered while testing `pre-request-validation.ts` — an
`expect(stderrCalls).toContain(cause)` assertion failed because the `cause`
Error instance had been coerced to its `toString()` form inside the colored
string.

**How to apply:** When asserting on error content that's passed as a chalk
argument, check the rendered message string, not the original Error reference:

```ts
const causeMessage = 'ECONNREFUSED 127.0.0.1:5052';
const cause = new Error(causeMessage);
// ...
const stderrOutput = stderrSpy.mock.calls.flat().join('\n');
expect(stderrOutput).toContain(BEACON_API_ERROR);
expect(stderrOutput).toContain(causeMessage); // not toContain(cause)
```

This also applies to any `console.log`/`console.error` spy where the source uses
chalk or template-string style formatting — `mock.calls` will be tuples of one
already-joined string rather than the original arg list.
