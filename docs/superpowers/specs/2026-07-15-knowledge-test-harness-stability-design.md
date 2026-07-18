# Knowledge Test Harness Stability Design

**Status:** Approved on 2026-07-15

## Problem

The Knowledge MCP implementation at commit `a9a7075` passed its task review and
final branch review, but a controller-owned fresh Node 20 run exposed three
load-sensitive test failures:

- `external-candidates.test.ts` synchronously runs a complete TypeScript build in
  a Vitest `beforeAll` hook with a fixed 10-second budget. The same build took
  13.127 seconds directly and 16.551 seconds inside the hook.
- `compiled-start.test.ts` performs the same complete build again, so a complete
  suite compiles the same package at least twice and writes the same `dist` tree.
- Two deployment contract tests call Git Bash through `spawnSync`. The script then
  starts many short-lived MSYS processes. On Windows, the fixture's inherited
  `PATH` can also resolve `#!/usr/bin/env bash` to the Windows WSL shim. Standalone
  executions took 10.830 and 12.064 seconds while blocking Vitest's event loop,
  so the default 5-second timer could not interrupt or diagnose them accurately.

These are test-harness defects. No evidence connects them to the Task 12
fail-closed package coverage or canonical path-containment implementation.

## Goals

- Compile runtime test artifacts once per Vitest invocation, outside file-level
  hooks, and let both compiled-artifact consumers share the same output.
- Make deployment contract subprocess execution asynchronous, event-driven, and
  bounded by one explicit total deadline.
- Resolve Git Bash and its utilities deterministically on Windows so the tests do
  not depend on WSL or host `PATH` ordering.
- Preserve the current behavioral assertions for external imports, compiled server
  health, successful deployment, rollback, image pinning, and mcp-only recreation.
- Keep production build, deployment, quality gates, and runtime code unchanged.

## Non-Goals

- Do not change `deploy/update-knowledge.sh` behavior.
- Do not skip tests on Windows or Linux.
- Do not increase global Vitest `testTimeout` or `hookTimeout`.
- Do not hide child-process failures, retry failed assertions, or weaken expected
  logs and state transitions.
- Do not access the network, build production databases or images, push GHCR, or
  deploy VPS state.

## Considered Approaches

### 1. Shared suite build plus asynchronous deployment harness (selected)

Use Vitest `globalSetup` to run one TypeScript build for the invocation. Remove the
duplicate builds from both test files. Convert the deployment stub to asynchronous
`spawn`, give it an explicit Git Bash environment, and make `exit`, `error`, and a
single total deadline compete.

This fixes the responsibility boundary instead of treating normal compilation and
shell startup as file-level test work. It preserves all real integration coverage.

### 2. Increase existing hook and test timeouts

This is small, but it leaves duplicate builds, synchronous event-loop blocking, and
ambiguous shell resolution intact. It would make failures slower and less
diagnostic, so it is rejected.

### 3. Replace process-level tests with static or in-process assertions

This would be fast, but it would stop proving that emitted CLI files and the real
deployment script behave correctly. It weakens release evidence and is rejected.

## Selected Architecture

### Suite-level runtime artifact build

Create `tools/n8n-knowledge-mcp/vitest.global-setup.ts` and register it through
`vitest.config.ts`. The setup starts the existing TypeScript compiler with
`process.execPath` and `node_modules/typescript/bin/tsc`, using `spawn` rather than a
synchronous child process. It captures stdout and stderr and resolves only on exit
code zero.

The setup has one 60-second total build deadline. `error`, non-zero `exit`, and the
deadline reject with command, exit/signal, stdout, and stderr diagnostics. The
deadline terminates the compiler child before rejecting. This deadline guards a
stuck compiler; it is not a Vitest hook timeout and does not weaken any test.

`external-candidates.test.ts` removes its `beforeAll` build and continues to execute
the two emitted CLI files. `compiled-start.test.ts` removes its local build and
continues to start `dist/src/server.js`, using its existing health/exit/error
readiness race and 30-second server deadline. A Vitest invocation therefore creates
one coherent `dist` tree before either consumer runs.

### Deterministic Git Bash environment

`deployment-contract.test.ts` resolves the Windows executable explicitly as
`C:\\Program Files\\Git\\bin\\bash.exe`. Its child environment prepends the fixture
bin directory and Git's `usr\\bin` and `bin` directories before the inherited host
path. The Docker stub uses `#!/usr/bin/bash`, not `#!/usr/bin/env bash`, so the stub
cannot select the Windows WSL shim from host path ordering.

On non-Windows hosts, the test continues to use `bash` and the normal POSIX path.
If the selected shell cannot start, the test fails with the executable and captured
diagnostics; it never silently skips the behavioral assertions.

### Asynchronous deployment process boundary

Change `runDeployStub` to return a promise. It starts exactly one top-level Git Bash
child with `spawn`, captures stdout/stderr, and waits on `error`, `close`, or one
30-second execution deadline. The behavioral tests become async and await the result.

On timeout, the helper starts whole-tree termination and enters a separate four-second
termination-confirmation grace stage. This grace stage does not extend the execution
budget and is never used by successful commands. If the original child closes during
grace, the helper rejects with the command, elapsed time, exit/signal, captured output,
and termination diagnostics, then permits fixture cleanup. If closure cannot be
confirmed before grace expires, the helper rejects deterministically with
`cleanupSafe: false`, releases its local pipe and termination-command handles, and
retains the fixture directory instead of deleting data that a surviving descendant may
still use. Test wrappers receive a 35-second ceiling so the 30-second execution deadline
plus four-second termination grace settle first; no global timeout changes.

The lifecycle regression must cover the adversarial ordering that triggered review:
the direct parent spawns a descendant with inherited stdout/stderr and exits immediately.
A test-only `triggerDeadlineOnExit` control invokes the same idempotent deadline handler
after the direct parent's `exit`, avoiding a new load-sensitive cold-start threshold.
The regression also supplies a guaranteed-nonexistent `terminationTargetPid`, causing
the real Windows `taskkill /T /F` or POSIX group kill to fail deterministically while
the descendant retains the inherited pipes. Normal callers enable neither control and
retain the real child PID and 30-second timer. The helper must reject within the grace
bound, mark cleanup unsafe, and never hang.

The Docker stub and production deployment script remain separate processes so the
tests still exercise the real script boundary. The controlled shell and path remove
the accidental WSL dependency, while async process handling prevents Vitest's event
loop from being blocked.

## Data and Control Flow

```text
Vitest invocation
  -> globalSetup
       -> async Node 20 -> tsc
       -> one coherent dist tree or fail with diagnostics
  -> external candidate tests consume emitted CLI files
  -> compiled-start test consumes emitted server file
  -> deployment contract test
       -> async explicit Git Bash
       -> controlled Git/MSYS PATH
       -> real update-knowledge.sh
       -> /usr/bin/bash Docker stub
       -> exit/error/execution deadline
       -> bounded termination confirmation
       -> cleanup-safe result or retained fixture
```

## Error Handling

- A compiler spawn error, non-zero exit, signal, or 60-second deadline fails setup
  before any test consumes `dist`.
- A deployment shell spawn error, non-zero/zero exit, or 30-second execution deadline
  is returned or rejected with full diagnostics. Business assertions still decide
  whether a zero or non-zero deployment status is expected.
- Deadline termination receives one four-second confirmation grace. Grace expiry is a
  deterministic failure, never a retry or a successful result.
- Cleanup runs only after confirmed process settlement. An unconfirmed tree produces a
  `cleanupSafe: false` error and retains the fixture directory with its path in the
  diagnostics.
- No retry converts a failing build or deployment into a passing test.

## Testing Strategy

Follow strict RED-GREEN TDD:

1. Add a regression contract proving neither compiled-artifact consumer contains a
   local `tsc` invocation and Vitest registers one global setup build.
2. Add a Windows-path regression that places a non-Git `bash` earlier in inherited
   path state and proves the deployment helper still selects explicit Git Bash and
   `/usr/bin/bash` for the Docker stub.
3. Add focused error/deadline coverage for the asynchronous process helper so a
   child error, non-zero exit, deadline, and parent-exited pipe-holding descendant
   settle once and include diagnostics.
4. Run the external and compiled-start files together under Node 20, then the
   deployment contract file, then the complete Knowledge suite once.
5. Run Node 20 TypeScript, `git diff --check`, and verify the worktree is clean after
   the implementation commit.

The complete Knowledge suite must report all 210 tests passing with no skipped or
failed tests. TypeScript and diff checks must exit zero.

## Scope

Expected files:

- Create: `tools/n8n-knowledge-mcp/vitest.global-setup.ts`
- Modify: `tools/n8n-knowledge-mcp/vitest.config.ts`
- Modify: `tools/n8n-knowledge-mcp/src/external-candidates.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`

No production source, deployment script, dependency, lockfile, generated artifact,
or release workflow belongs in this change.

## Acceptance Criteria

- One TypeScript build occurs per Vitest invocation; neither consumer compiles in a
  file-level hook or test.
- External candidate and compiled-server tests consume the same emitted artifacts.
- Windows deployment tests cannot resolve Bash through WSL or inherited path order.
- Deployment subprocesses do not block the Node event loop and are bounded by one
  terminating total deadline with actionable diagnostics.
- Healthy and rollback deployment assertions remain unchanged in meaning.
- Node 20 reports 18/18 files and 210/210 tests passing; TypeScript and diff check
  exit zero.
- Network build, image build, GHCR, and VPS operations remain outside authorization.

## Release Evidence Boundary

This design repairs local test evidence only. After implementation, review, and a
fresh local Node 20 pass, the new final commit still requires separate explicit
SHA-bound authorization before any clean Linux online build, local image build, or
authenticated smoke. GHCR push and VPS deployment remain unauthorized.
