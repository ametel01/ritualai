# Plan 006: Show Interactive Warning Diagnostics

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/cli/interactive.ts src/history/parse-shared.ts test/integration/session.test.ts test/unit/history.test.ts README.md docs/PRD.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `0ce330a`, 2026-06-20

## Why this matters

Ritual promises that malformed records produce diagnostics and do not stop other
history files from being scanned. The parser does produce warning diagnostics,
but the interactive flow filters discovery and scan diagnostics down to errors
only. Users can therefore see lower prompt counts without seeing why records or
files were skipped.

This plan is intentionally separate from `plans/005-surface-prompt-dump-diagnostics.md`.
Plan 005 covers the non-interactive `prompts` command; this plan covers the
default interactive flow.

## Current state

- `src/cli/interactive.ts` owns the default interactive flow and prints
  diagnostics before agent discovery or fallback ranking.
- `src/history/parse-shared.ts` emits warning diagnostics for malformed JSONL
  records.
- `test/integration/session.test.ts` already captures interactive output.
- `test/unit/history.test.ts` shows parser warning behavior directly.

Current relevant excerpts:

```ts
// src/cli/interactive.ts:91
for (const line of formatDiagnostics(discovered.diagnostics.filter(isErrorDiagnostic))) {
  output.write(line);
}
```

```ts
// src/cli/interactive.ts:99
for (const line of formatDiagnostics(scan.diagnostics.filter(isErrorDiagnostic))) {
  output.write(line);
}
```

```ts
// src/history/parse-shared.ts:54
diagnostics.push({
  level: "warning",
  message: `Malformed JSON record at line ${lineNumber}.`,
  sourcePath,
});
```

Documented behavior:

```md
README.md:83
The interactive flow can add one extra Claude or Codex history file or directory.
README.md:84
Malformed records produce diagnostics and do not stop other files from being
README.md:85
scanned.
docs/PRD.md:97
- Allow partial support with clear diagnostics when one source cannot be parsed.
```

Repo conventions to follow:

- Diagnostics are formatted through `formatDiagnostics` from
  `src/telemetry/diagnostics.ts`.
- Interactive session tests use `QueuePrompts`, fake runners/launchers, temp
  directories, and captured `outputs`.
- Keep prompt extraction local-only and do not read real Claude or Codex history
  in tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Integration tests | `bun run test -- test/integration/session.test.ts` | session tests pass |
| History tests | `bun run test -- test/unit/history.test.ts` | history tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |
| Full tests | `bun run test` | all tests pass |

## Scope

**In scope**:

- `src/cli/interactive.ts`
- `test/integration/session.test.ts`
- `test/unit/history.test.ts` only if a smaller parser fixture is needed for
  shared test data

**Read-only reference while working**:

- `src/history/parse-shared.ts`
- `src/telemetry/diagnostics.ts`
- `README.md`
- `docs/PRD.md`

**Out of scope**:

- Changing parser warning messages.
- Changing `prompts` command diagnostics. That is covered by Plan 005.
- Showing info-level missing default-path diagnostics by default.
- Treating warnings as fatal errors.

## Git workflow

- Branch: `advisor/006-show-interactive-warning-diagnostics`
- Commit message style: `fix: show interactive history warnings`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add an interactive regression test for scan warnings

In `test/integration/session.test.ts`, add a test that uses an extra Codex
source file containing:

- One valid user prompt record.
- One malformed JSONL line.

Use injected temp directories so no real history is read. Drive the flow far
enough to parse history and then cancel through agent discovery/fallback choices
without launching a real agent.

Assert that captured `outputs` include a formatted warning containing
`Malformed JSON record at line`.

If the current flow makes it awkward to reach this case without completing a
candidate path, keep the prompt fixture small and exit through an existing
cancel/decline branch. Do not launch real `claude` or `codex`.

**Verify**: `bun run test -- test/integration/session.test.ts` should fail
before the production change because warnings are currently filtered out.

### Step 2: Print non-info diagnostics in the interactive flow

In `src/cli/interactive.ts`, replace the current error-only filter with a helper
that excludes only info diagnostics.

Target shape:

```ts
function isVisibleDiagnostic(diagnostic: { level: string }): boolean {
  return diagnostic.level !== "info";
}
```

Then use:

```ts
formatDiagnostics(discovered.diagnostics.filter(isVisibleDiagnostic))
formatDiagnostics(scan.diagnostics.filter(isVisibleDiagnostic))
```

This should show warnings and errors, while keeping routine missing default-path
info messages hidden.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 3: Confirm parser unit coverage still matches the behavior

Run the existing history parser tests. If they already cover malformed-record
warnings, do not add duplicate unit tests. If the integration test needed a
shared fixture and parser coverage is missing for that exact record shape, add a
small unit test in `test/unit/history.test.ts`.

**Verify**: `bun run test -- test/unit/history.test.ts` passes.

### Step 4: Run repo checks

Run the standard gates.

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Add an integration test in `test/integration/session.test.ts` proving warning
  diagnostics reach the interactive output.
- Reuse existing parser tests as the source-of-truth for warning generation.
- Keep real history and real skill roots out of tests.

## Done criteria

- [ ] Interactive flow prints warning diagnostics from discovery and scan.
- [ ] Info-level missing default-path diagnostics remain hidden by default.
- [ ] Existing error diagnostics still print.
- [ ] `bun run test -- test/integration/session.test.ts` exits 0.
- [ ] `bun run test -- test/unit/history.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Interactive diagnostics have already been refactored and the excerpts above
  no longer match.
- Showing warnings requires changing parser diagnostic types.
- The maintainer wants warnings hidden in interactive mode despite README/PRD
  wording.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Reviewers should check that this does not flood normal runs with every missing
default path. If verbose diagnostics are added later, keep this default behavior
focused on warnings and errors.

