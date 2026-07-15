# Knowledge Global Setup Settlement Design

## Status

Approved on 2026-07-15 as a scope expansion after the final whole-branch review of
Knowledge MCP Task 15.

## Problem

`tools/n8n-knowledge-mcp/vitest.global-setup.ts` starts the TypeScript compiler with a
60-second deadline. When that deadline expires, the setup calls `child.kill()` but still
waits exclusively for a future `close` event before rejecting. If the kill request fails
or the child never closes, global setup can wait forever, so the documented 60-second
total deadline is not actually bounded.

## Goal

Give the runtime-artifact build a deterministic upper bound while preserving its existing
successful-build, spawn-failure, compiler-failure, and ordinary timeout behavior.

The build receives 60 seconds to finish. After the main deadline, it receives one
four-second termination grace. The rejection path is therefore scheduled at no more than
64,000 ms after spawn, excluding only normal event-loop scheduling delay, even if the child
never emits `close`.

## Approaches Considered

### A. Two-stage deterministic settlement (selected)

Keep the current 60-second build deadline. At expiry, record the result of `child.kill()`
and start a four-second termination grace. A child that closes during grace uses the
ordinary timeout rejection. If no close arrives, release local handles and reject from
the grace callback with complete diagnostics.

This preserves a cleanup opportunity without allowing an unbounded wait.

### B. Reject immediately at 60 seconds

This is simpler, but it can leave the compiler alive while the suite continues or exits.
It does not provide evidence that local pipe handles were released.

### C. Add cross-platform process-tree termination

This offers stronger descendant cleanup, but it duplicates the deployment test harness's
platform-specific termination machinery and substantially enlarges this focused fix.
The TypeScript compiler invocation is a direct child, so this complexity is not justified.

## Architecture

### Runtime build helper

Extract the current global-setup body into an exported runtime-build helper. Its production
defaults remain:

- Node executable: `process.execPath`
- compiler: `node_modules/typescript/bin/tsc`
- project: `tsconfig.json`
- build deadline: 60,000 ms
- termination grace: 4,000 ms

The default export calls this helper with production defaults. A narrow control object
contains only `spawnBuild`, `buildDeadlineMs`, and `terminationGraceMs`. The injected spawn
function returns the child-process subset used by the helper: `pid`, `exitCode`,
`signalCode`, `stdout`, `stderr`, `kill()`, `unref()`, and one-shot `error`/`close`
listeners. Normal global setup callers never provide this control object.

### Settlement state

The helper uses one settle-once function and tracks:

- whether the build deadline fired;
- whether the promise already settled;
- the main deadline handle;
- the termination-grace handle;
- the boolean returned by `child.kill()`, or the message if it throws;
- accumulated stdout and stderr.

Before the deadline, `error` and `close` preserve existing behavior. At the deadline:

1. mark the build timed out;
2. call `child.kill()` and record its return value, catching and recording an exception
   without skipping the grace timer;
3. start the four-second grace timer.

If `close` arrives during grace, clear both timers and reject with the existing timeout
category plus kill diagnostics. If grace expires first, destroy the child's stdout and
stderr streams, unref the child, and reject immediately. Late `close` and `error` events
are settle-once no-ops.

### Diagnostics

Every timeout rejection includes:

- the command and arguments;
- elapsed milliseconds;
- child PID when available;
- exit code and signal when available;
- `killRequested=<true|false>` and `killError=<message|none>`;
- whether settlement occurred through `close` or `termination-grace`;
- captured stdout and stderr.

Spawn failures and non-zero compiler exits retain their current error categories and gain
no retry behavior.

## Testing

Keep exactly 18 Vitest files and 210 tests. Extend the existing compiled-start metadata
test instead of creating a new test case.

The deterministic regression injects a child double that:

- exposes stdout and stderr streams;
- returns `false` from `kill()`;
- never emits `close`;
- records stream destruction and `unref()`.

With injected short deadline values or controlled timers, the existing test must first fail
against the unbounded implementation, then pass only when the termination grace rejects and
releases every local handle. It must assert the diagnostic PID, kill result, grace settlement
reason, and captured output.

Focused verification covers compiled-start, followed by the four Knowledge stability files,
fixed-Node-20 TypeScript, `git diff --check`, the full 18-file/210-test suite, and a fresh
whole-branch lifecycle review.

## Scope

Modify exactly:

- `tools/n8n-knowledge-mcp/vitest.global-setup.ts`
- `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`

Do not modify production server or scripts, Vitest configuration, dependencies, lockfiles,
generated databases, Docker assets, workflows, images, GHCR, VPS state, or timeout values
outside the injected regression controls. Do not add retries, skips, or test cases.
