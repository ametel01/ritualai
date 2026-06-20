# Plan 003: Cover The Fallback Write And Mirror Path

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/cli/interactive.ts src/skills/write.ts src/skills/paths.ts test/integration/session.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `0ce330a`, 2026-06-20

## Why this matters

The local fallback path is the path where Ritual itself chooses a repeated
workflow candidate, launches a drafting agent, validates the resulting skill,
and mirrors it to additional selected ecosystems. This is the riskiest user-file
write path in the app, but current integration tests mostly cover the agent
discovery handoff and assert that no local skill file was written. Strong
coverage here makes later changes to the interactive flow safer.

## Current state

- `src/cli/interactive.ts` owns the fallback write flow.
- `src/skills/write.ts` mirrors validated content to additional targets.
- `src/skills/paths.ts` resolves project-local and global skill target paths.
- `test/integration/session.test.ts` has fake prompts, runner, launcher, output,
  and temporary directories.

Current relevant excerpts:

```ts
// src/cli/interactive.ts:151
const ecosystems = await prompts.checkbox<SkillEcosystem>("Output ecosystem", [
  { name: "Claude", value: "claude", checked: true },
  { name: "Codex/agents", value: "codex", checked: true },
]);
```

```ts
// src/cli/interactive.ts:180
const exitCode = await launchSkillDraftAgent({
  request: { candidate, skillName, scope, ecosystems },
  executable,
  cwd,
  skillPath: primaryTarget.skillPath,
  launcher,
});
```

```ts
// src/cli/interactive.ts:204
const additionalTargets = targets.slice(1);
const additionalWrittenPaths = await writeFinalSkill({
  targets: additionalTargets,
  content: skillContent,
  fs,
});
```

```ts
// test/integration/session.test.ts:141
expect(result).toEqual({ status: "handed-off", executable: "claude" });
...
await expect(access(claudePath)).rejects.toThrow();
```

Documented required coverage:

```md
docs/TECH_SPEC.md:204
Required integration coverage:
docs/TECH_SPEC.md:212
- Direct write to project-local Claude target.
docs/TECH_SPEC.md:213
- Direct write to project-local Codex/agents target.
docs/TECH_SPEC.md:214
- Mirroring the direct write to both targets.
```

Repo conventions to follow:

- Integration tests use `mkdtemp` under `os.tmpdir()` and never read real
  Claude or Codex history.
- Use injected `PromptAdapter`, `CommandRunner`, and `CommandLauncher`.
- Use `nodeFileSystem.writeTextAtomic` when fake agents write files.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Integration tests | `bun run test -- test/integration/session.test.ts` | session tests pass |
| Full tests | `bun run test` | all tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |

## Scope

**In scope**:

- `test/integration/session.test.ts`
- `src/cli/interactive.ts` only if a small testability seam is required

**Read-only reference while working**:

- `src/skills/write.ts`
- `src/skills/paths.ts`

**Out of scope**:

- Changing target path semantics.
- Changing validation behavior; Plan 002 covers validation warning behavior.
- Changing agent discovery handoff behavior.
- Writing tests that touch real home-directory skill roots.

## Git workflow

- Branch: `advisor/003-cover-fallback-write-mirror`
- Commit message style: `test: cover fallback skill writes`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a fallback happy-path integration test

In `test/integration/session.test.ts`, add a test that declines agent discovery
and proceeds through local fallback ranking.

Use the existing `codex-repeat.jsonl` fixture. The prompt answer sequence should
match the current flow:

1. Confirm adding an extra source if no defaults exist.
2. Select `codex` for extra source type.
3. Input fixture path.
4. Decline local agent discovery.
5. Select the locally ranked candidate.
6. Input a stable skill name such as `pr-review-workflow`.
7. Select project scope.
8. Select both ecosystems.
9. Select `claude` as the draft executable.

Adjust the exact queue order to match `runInteractiveSession` as implemented.
The fake launcher should detect the skill-generation prompt and write a valid
`SKILL.md` to the path contained in the generated handoff prompt.

Expected assertions:

- Result is `{ status: "completed", ... }`.
- Project-local Claude target exists.
- Project-local Codex/agents target exists.
- Both files have identical content.
- The primary target content includes the expected frontmatter name.
- The launcher received the generated skill prompt, not the discovery prompt.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 2: Add single-ecosystem direct-write coverage

Add a second integration test, or parameterize the first one, to select only one
ecosystem:

- Claude only should write `.claude/skills/<name>/SKILL.md` and not write
  `.agents/skills/<name>/SKILL.md`.
- Codex only should write `.agents/skills/<name>/SKILL.md` and not write
  `.claude/skills/<name>/SKILL.md`.

At minimum, cover one of these as a direct-write-only path in this plan. Prefer
covering both if the test remains small.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 3: Add overwrite-denial coverage if missing

If the existing tests still do not cover refusing an overwrite after target
resolution, add a test that pre-creates the target `SKILL.md`, answers "no" to
the overwrite confirmation, and asserts:

- Result is `{ status: "cancelled", reason: "Target write was not approved." }`.
- The existing file content is unchanged.
- No agent launcher invocation occurred for drafting.

Skip this step only if equivalent coverage already exists by the time you run
the drift check.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 4: Run repo checks

Run the standard gates.

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- New integration tests in `test/integration/session.test.ts`.
- Cover both-output mirroring and at least one single-output direct write.
- Prefer no production changes; if a small helper is needed, keep it private to
  `src/cli/interactive.ts` and verify no behavior changes.

## Done criteria

- [ ] Integration coverage exists for project-local fallback writing.
- [ ] Integration coverage exists for mirroring one valid skill to both
  `.claude` and `.agents` targets.
- [ ] Integration coverage exists for at least one single-ecosystem write.
- [ ] Existing real-history isolation remains intact; tests use temp dirs and
  fixtures only.
- [ ] `bun run test -- test/integration/session.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No production files are modified unless a small testability seam was
  necessary and justified in the commit.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The fallback flow has been removed in favor of agent-discovery-only behavior.
- Writing the test requires launching real `claude` or `codex`.
- Writing the test requires reading the developer's real history or home skill
  roots.
- The test requires broad production refactoring rather than injected fakes.

## Maintenance notes

Reviewers should check that tests assert file contents, not just returned paths.
Future changes to the interactive flow should keep this suite as the safety net
for user-file writes.

