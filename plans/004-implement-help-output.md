# Plan 004: Implement Real CLI Help Output

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/cli/runtime.ts test/unit/cli-runtime.test.ts README.md`
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

`ritual help` is normalized to `--help`, but `--help` is rejected as an unknown
command. That makes the only apparent help path exit with an error and print a
usage string to stderr. A small, stable help command improves onboarding and
keeps the CLI behavior aligned with user expectations.

## Current state

- `src/cli/runtime.ts` parses CLI commands.
- `test/unit/cli-runtime.test.ts` tests runtime argument behavior.
- `README.md` documents published usage but does not show help output.

Current relevant excerpts:

```ts
// src/cli/runtime.ts:76
export function normalizeHelpInvocation(args: readonly string[]): string[] {
  return args.map((arg) => (arg === "help" ? "--help" : arg));
}
```

```ts
// src/cli/runtime.ts:89
if (args[0] !== "prompts" && args[0] !== "--prompts") {
  return { kind: "error", message: "Usage: ritual [prompts|--prompts [--limit N]]" };
}
```

```ts
// test/unit/cli-runtime.test.ts:25
it("normalizes bare help before argument handling", () => {
  expect(normalizeHelpInvocation(["help"])).toEqual(["--help"]);
});
```

Usage currently documented:

```md
README.md:11
npx ritualai@latest
README.md:18
npx ritualai@latest prompts
README.md:19
npx ritualai@latest --prompts
```

Repo conventions to follow:

- Runtime tests use injected output and exit-code collectors.
- Unknown commands should continue to exit 1.
- Help should write to stdout and exit 0.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `bun run test -- test/unit/cli-runtime.test.ts` | runtime tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |
| Full tests | `bun run test` | all tests pass |

## Scope

**In scope**:

- `src/cli/runtime.ts`
- `test/unit/cli-runtime.test.ts`
- `README.md` only if documenting the new help flag

**Out of scope**:

- Adding a full command framework.
- Adding new subcommands beyond help.
- Changing interactive or prompt-dump behavior.

## Git workflow

- Branch: `advisor/004-implement-help-output`
- Commit message style: `fix: add cli help output`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add help command tests

In `test/unit/cli-runtime.test.ts`, add tests for:

- `ritual --help` writes help to stdout, sets no error exit code, and does not
  run interactive or prompt dump.
- `ritual help` behaves the same after normalization.
- Unknown commands still write the existing usage error and exit 1.

The help text should include at least:

- `Usage: ritual [prompts|--prompts [--limit N]]`
- `ritual`
- `ritual prompts --limit 25`

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` fails before the
runtime change.

### Step 2: Add a help command variant

In `src/cli/runtime.ts`, extend `CliCommand` with `{ kind: "help" }`.

Update `parseCliCommand` so these invocations return help:

- `["--help"]`
- `["-h"]`
- normalized `["--help"]` from bare `help`

Add a small `formatHelp()` function returning a stable multi-line string. Keep
the existing usage string for errors or reuse the first line from `formatHelp`.

In `runCli`, handle `command.kind === "help"` by writing help to stdout,
unrefing stdin, and returning without setting an exit code.

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` passes.

### Step 3: Document help only if useful

If the help output is user-visible and stable, add one short README usage line:

```bash
npx ritualai@latest --help
```

Do not expand README into a full CLI reference.

**Verify**: `bun run check` passes.

### Step 4: Run repo checks

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Add runtime unit tests for `--help`, `-h`, and `help`.
- Preserve existing unknown-command test.
- No integration tests are necessary for this narrow parser behavior.

## Done criteria

- [ ] `ritual --help`, `ritual -h`, and `ritual help` print help to stdout and
  exit 0.
- [ ] Unknown commands still exit 1.
- [ ] Help tests exist in `test/unit/cli-runtime.test.ts`.
- [ ] `bun run test -- test/unit/cli-runtime.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- A command framework has already replaced `parseCliCommand`.
- The maintainer wants no help command and prefers removing normalization.
- Help output requires changing package bin names or public API exports.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Keep help text short and stable because tests should assert it. If new
subcommands are added later, update `formatHelp` and its tests in the same PR.

