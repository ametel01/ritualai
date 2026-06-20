# Plan 007: Offer Extra History Source When Defaults Exist

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/cli/interactive.ts test/integration/session.test.ts README.md docs/PRD.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `0ce330a`, 2026-06-20

## Why this matters

The README says the interactive flow can add one extra Claude or Codex history
file or directory. The PRD says Ritual should ask for additional history paths
when automatic discovery is incomplete. The implementation only asks for an
extra source when zero default sources were found, so a user with one default
history file cannot add another missing session directory through the default
flow.

## Current state

- `src/cli/interactive.ts` discovers default history sources and optionally asks
  for extra sources.
- `askForExtraSources` already implements the prompt sequence for one extra
  source.
- `test/integration/session.test.ts` has coverage for the zero-default-source
  path.

Current relevant excerpts:

```ts
// src/cli/interactive.ts:76
const discovered = await withSpinner(spinner, "Finding local history sources...", () =>
  discoverHistorySources({ cwd, homeDir, env }),
);
let sources = discovered.sources;
if (sources.length === 0) {
  const extraSources = await askForExtraSources(prompts);
```

```ts
// src/cli/interactive.ts:329
const addExtra = await prompts.confirm("Add an extra history file or directory?", false);
if (!addExtra) {
  return [];
}
const kind = await prompts.select<HistorySource["kind"]>("Extra source type", [
  { name: "Claude", value: "claude" },
  { name: "Codex", value: "codex" },
]);
const sourcePath = await prompts.input("Extra history path");
return sourcePath.trim().length === 0 ? [] : [{ kind, path: sourcePath.trim() }];
```

Existing integration tests only exercise the no-default-source route:

```ts
// test/integration/session.test.ts:123
const prompts = new QueuePrompts({
  confirms: [true, true],
  inputs: [fixturePath],
  selects: ["codex", "claude"],
  checkboxes: [],
});
```

Documented behavior:

```md
README.md:83
The interactive flow can add one extra Claude or Codex history file or directory.
docs/PRD.md:94
- Ask interactively for additional history paths when automatic discovery is incomplete.
```

Repo conventions to follow:

- Keep all runtime choices as interactive prompts.
- Use temp directories and fixture history in integration tests.
- Avoid adding command-line flags for the default skill-generation flow.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Integration tests | `bun run test -- test/integration/session.test.ts` | session tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |
| Full tests | `bun run test` | all tests pass |

## Scope

**In scope**:

- `src/cli/interactive.ts`
- `test/integration/session.test.ts`

**Read-only reference while working**:

- `README.md`
- `docs/PRD.md`

**Out of scope**:

- Supporting more than one extra source in this plan.
- Adding CLI flags for extra sources.
- Changing discovery defaults.
- Changing the prompt dump command.
- Persisting selected extra source paths.

## Git workflow

- Branch: `advisor/007-offer-extra-source-when-defaults-exist`
- Commit message style: `fix: allow extra history source with defaults`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a regression test with one default source plus one extra source

In `test/integration/session.test.ts`, create a test where:

- A default history source exists under the temp `homeDir`, such as
  `.codex/history.jsonl`.
- An extra source fixture exists at another temp path.
- The prompt adapter answers yes to "Add an extra history file or directory?"
  even though the default source exists.

Assert that the interactive output includes a source summary reflecting prompts
from both the default source and the extra source, or assert via a narrower fake
dependency if the existing public output is too indirect.

Keep the test from launching a real agent. Use the existing fake runner and fake
launcher patterns.

**Verify**: `bun run test -- test/integration/session.test.ts` should fail
before the production change because the extra-source prompt is not asked when a
default source exists.

### Step 2: Ask for an extra source after default discovery

In `src/cli/interactive.ts`, move the `askForExtraSources(prompts)` call so the
user gets one opportunity to add a source after default discovery, regardless of
whether defaults were found.

Keep the default answer as `false`.

Recommended behavior:

1. Discover defaults.
2. Ask whether to add one extra source.
3. If the user supplies one, discover that extra source and append its discovered
   files to the existing defaults.
4. Push extra-source diagnostics into the existing diagnostic list.
5. Preserve deduplication from `discoverHistorySources`.

Be careful not to drop default sources when extra-source discovery succeeds.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 3: Preserve the zero-default-source behavior

Confirm the existing tests where there are no default sources still pass:

- User can add an extra source.
- User can decline or cancel if no prompts are available.

If needed, adjust prompt queues in existing tests to account for the extra-source
confirm now appearing in more runs. Keep assertions focused on behavior, not on
internal prompt count unless necessary.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 4: Run repo checks

Run the standard gates.

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Add an integration regression for defaults plus extra source.
- Preserve existing zero-default-source integration coverage.
- No unit tests are required unless extracting a helper makes the behavior easier
  to cover.

## Done criteria

- [ ] Interactive flow offers one extra-source prompt even when default sources
  exist.
- [ ] Choosing an extra source appends it without dropping defaults.
- [ ] Declining the prompt preserves current default-only behavior.
- [ ] Existing no-default-source behavior still works.
- [ ] `bun run test -- test/integration/session.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The interactive flow has already been changed so extra sources are handled
  elsewhere.
- The test requires reading real Claude or Codex history.
- Supporting defaults plus extra source requires changing public CLI flags.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Reviewers should check prompt ergonomics: the default should remain no, so users
with complete default discovery can continue quickly. If multiple extra sources
become necessary later, add that as a separate product decision rather than
expanding this plan opportunistically.

