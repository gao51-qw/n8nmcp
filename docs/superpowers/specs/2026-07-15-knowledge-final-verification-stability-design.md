# Knowledge Final Verification Stability Design

## Status

Approved on 2026-07-15. This design closes the two Important findings from the
whole-branch review and the two synchronous CLI timeout domains exposed by the final
Node 20 suite.

## Goal

Make the existing 210-test Knowledge MCP suite deterministic without increasing
timeouts, skipping coverage, retrying failures, weakening assertions, or changing
production behavior.

## Evidence and Root Causes

The fresh Node 20 suite at `0e594b4` reported 198/210 passing. All 12 failures were
default 5-second timeouts in two test files:

- Six external-candidate empty/whitespace rows each launch three synchronous Node
  processes. A focused reproduction made all six fail in 5.12-6.34 seconds.
- Production-artifact verification launches `node -> tsx -> TypeScript` for every one
  of 21 cases. A focused reproduction produced 18 timeouts while three neighboring
  cases passed at 4.69-4.93 seconds. The verifier contains no waits or network calls.

The final branch reviewer also found two lifecycle gaps:

- Deployment cleanup becomes safe when the top-level child closes even if the
  process-tree termination helper is still pending or failed.
- Compiled-server cleanup treats `exitCode === null` as running, which is also true
  after a signal, then subscribes to an `exit` event that may already have occurred.

## Architecture

### 1. External candidate baseline snapshots

Prepare one valid imported database baseline in `beforeAll`. After the importer closes
both SQLite files, snapshot the local and external databases into buffers. Each of the
six empty/whitespace cases creates its own fixture and restores those buffers before
mutating one JSON field.

The per-case behavior remains process-level: failed importer, successful verifier,
rollback checks, FTS parity, and promotion checks all remain. Only the redundant
successful importer is removed from each row, reducing three synchronous Node starts to
two.

### 2. Compiled production-artifact verifier

The Vitest global setup already compiles `scripts/**/*` once. The test harness must run
`dist/scripts/10-verify-production-artifacts.js` directly with the fixed Node process,
not start `tsx` for every case. All 21 real process-level malformed/error/hash/happy-path
assertions remain unchanged.

### 3. Dual confirmation for deployment cleanup

Timeout cleanup is safe only after both conditions are true within the four-second
grace:

1. the top-level command emitted `close`; and
2. `termination.completion` resolved successfully.

Track those states independently and evaluate them through one settle-once function.
A failed or still-pending termination command can never produce `cleanupSafe: true`.
Grace expiry releases helper/pipe handles and rejects with `cleanupSafe: false`.
Normal numeric exits and the 30-second execution deadline remain unchanged.

The existing lifecycle test must also cover a top-level child that closes while an
injected test-only termination handle remains pending. The same grace timer must reject
unsafe and call the handle's release function.

### 4. Pre-registered compiled-server settlement

Create the child settlement promise immediately after `spawn`, before health polling.
It resolves on `close`, with a pre-spawn `error` fallback when no PID exists. Cleanup
kills only when the child has not settled and both `exitCode` and `signalCode` are null,
then awaits the pre-registered settlement before removing the SQLite fixture.

The existing metadata test becomes async and exercises both a signal-terminated child
and a missing executable through the same settlement helper without increasing the
suite's test count.

## Error Handling

- No global or per-test timeout is increased.
- No retry converts a slow or failed command into success.
- Failed or incomplete process-tree termination retains the deployment fixture and
  includes `fixtureRetained=<root>` diagnostics.
- Compiled-server fixture deletion always follows terminal child settlement.
- Synchronous CLI results continue to expose real status/stdout/stderr to existing
  assertions.

## Scope

Modify exactly:

- `tools/n8n-knowledge-mcp/src/external-candidates.test.ts`
- `tools/n8n-knowledge-mcp/src/production-artifact-verifier.test.ts`
- `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`
- `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`

Do not modify production scripts, deployment scripts, server source, Vitest global
timeouts, dependencies, lockfiles, generated databases, Docker assets, workflows,
images, GHCR, or VPS state.

## Testing

Follow strict TDD using the fixed Node 20.20.2 executable:

1. Preserve the recorded external and production-verifier focused failures as RED.
2. Add lifecycle RED coverage inside existing test cases so the suite remains 210 tests.
3. Make each target file GREEN independently.
4. Run the four-file cross-domain set, Node 20 TypeScript, and `git diff --check`.
5. After independent review, run one fresh complete suite.

Acceptance requires 18/18 files, 210/210 tests, zero skipped, TypeScript exit zero,
diff check exit zero, clean worktree, and a final whole-branch review with no open
Critical or Important findings.
