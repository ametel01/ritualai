# Plan 005: Surface Prompt-Dump Diagnostics

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/cli/prompt-dump.ts src/cli/runtime.ts test/unit/prompt-dump.test.ts test/unit/cli-runtime.test.ts README.md`
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

The `prompts` command is the lightweight inspection surface for extracted local
prompts. It currently writes only prompt rows and drops discovery or parse
diagnostics, so missing, malformed, or unsupported sources can look like a
legitimate empty result. Diagnostics should be visible without corrupting stdout
TSV output that users may pipe into other tools.

## Current state

- `src/cli/prompt-dump.ts` discovers sources, scans them, writes TSV prompt
  lines to one output sink, and returns a count.
- `src/cli/runtime.ts` wires `runPromptDump` to `output.stdout`.
- `test/unit/prompt-dump.test.ts` tests ordering and formatting.
- `test/unit/cli-runtime.test.ts` tests prompt dump dispatch.

Current relevant excerpts:

```ts
// src/cli/prompt-dump.ts:31
const discovered = await discoverHistorySources({ cwd, homeDir, env });
const scan = await scanHistorySources(discovered.sources);
const prompts = latestPrompts(scan.prompts, limit);

for (const prompt of prompts) {
  output.write(formatPromptLine(prompt));
}
```

```ts
// src/cli/runtime.ts:50
await (options.runPromptDump ?? runPromptDump)({
  cwd: process.cwd(),
  homeDir: os.homedir(),
  env: process.env,
  limit: command.limit,
  output: { write: output.stdout },
});
```

```md
README.md:15
Dump the latest 100 extracted user prompts, newest first:
```

Documented requirements:

```md
docs/PRD.md:95
- Report which sources were scanned.
docs/PRD.md:96
- Report prompt extraction counts per source.
docs/PRD.md:97
- Allow partial support with clear diagnostics when one source cannot be parsed.
```

Repo conventions to follow:

- Reuse `formatDiagnostics` and `formatSourceSummary` from
  `src/telemetry/diagnostics.ts`.
- Keep prompt rows tab-separated on stdout.
- Tests use injected output sinks rather than real console output.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prompt dump tests | `bun run test -- test/unit/prompt-dump.test.ts` | prompt dump tests pass |
| Runtime tests | `bun run test -- test/unit/cli-runtime.test.ts` | runtime tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |
| Full tests | `bun run test` | all tests pass |

## Scope

**In scope**:

- `src/cli/prompt-dump.ts`
- `src/cli/runtime.ts`
- `test/unit/prompt-dump.test.ts`
- `test/unit/cli-runtime.test.ts`
- `README.md` only if documenting stderr diagnostics

**Out of scope**:

- Changing TSV prompt-row format.
- Adding JSON output.
- Changing interactive session diagnostics.
- Treating warning diagnostics as fatal errors.

## Git workflow

- Branch: `advisor/005-surface-prompt-dump-diagnostics`
- Commit message style: `fix: show prompt dump diagnostics`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add separate diagnostic output to prompt dump options

Extend `PromptDumpOptions` with an optional diagnostic sink, for example:

```ts
diagnosticsOutput?: PromptDumpOutput;
```

Default it to stderr in the real runtime path, but keep the direct
`runPromptDump()` default conservative. Recommended direct default:

- prompt rows still use stdout.
- diagnostics use `console.error` only when no custom sink is supplied.

If you choose a different name than `diagnosticsOutput`, keep it clear and
documented in the type.

**Verify**: `bun run typecheck` may fail until tests and runtime wiring are
updated.

### Step 2: Emit summaries and diagnostics to the diagnostic sink

In `runPromptDump`, after discovery and scan:

- Write source summaries from `formatSourceSummary(scan.sources)`.
- Write warning/error diagnostics from both discovery and scan using
  `formatDiagnostics`.
- Do not write info-level "path not found" diagnostics by default; they are too
  noisy for the prompt dump command.

Keep stdout prompt rows unchanged.

Recommended severity filter:

```ts
diagnostic.level !== "info"
```

**Verify**: Add tests first or immediately after this step.

### Step 3: Add prompt-dump unit tests

In `test/unit/prompt-dump.test.ts`, add tests that:

- Capture prompt rows separately from diagnostics.
- Use a malformed JSONL line plus one valid prompt.
- Assert stdout contains only TSV prompt rows.
- Assert diagnostics contain a source summary and a malformed-record warning.

Also cover the no-supported-sources case if it remains simple: diagnostics should
include `No supported history sources were scanned.` and prompt rows should be
empty.

**Verify**: `bun run test -- test/unit/prompt-dump.test.ts` passes.

### Step 4: Wire runtime stderr

In `src/cli/runtime.ts`, pass `diagnosticsOutput: { write: output.stderr }` when
calling `runPromptDump`.

Update `test/unit/cli-runtime.test.ts` to assert that the prompt dump options
include a diagnostic output sink, or add a dispatch test that invokes the sink
and confirms it uses stderr.

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` passes.

### Step 5: Document the behavior briefly

If README mentions prompt dumping, add one concise sentence near the prompt dump
usage:

```md
Prompt rows are written to stdout; source summaries and parse diagnostics are
written to stderr.
```

**Verify**: `bun run check` passes.

### Step 6: Run repo checks

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Unit tests in `test/unit/prompt-dump.test.ts` for diagnostics separation.
- Runtime unit test in `test/unit/cli-runtime.test.ts` for stderr wiring.
- Existing prompt ordering and TSV formatting tests must remain unchanged.

## Done criteria

- [ ] Prompt TSV rows remain on stdout and keep the same format.
- [ ] Source summaries and non-info diagnostics are visible through a separate
  diagnostic sink.
- [ ] Runtime wires prompt diagnostics to stderr.
- [ ] Tests cover malformed-source diagnostics without corrupting TSV output.
- [ ] `bun run test -- test/unit/prompt-dump.test.ts` exits 0.
- [ ] `bun run test -- test/unit/cli-runtime.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The maintainer wants stdout to remain the only output stream for `prompts`.
- Existing downstream tests or docs require absolutely no prompt-dump diagnostics.
- Implementing diagnostics requires changing the TSV prompt line format.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Future machine-readable formats should be added as explicit output modes rather
than changing the default TSV stream. Keep noisy missing-default-path info off
stderr unless the user asks for verbose diagnostics.

