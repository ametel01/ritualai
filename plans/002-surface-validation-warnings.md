# Plan 002: Surface Validation Warnings And Agnix Failures

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/skills/validate.ts src/cli/interactive.ts test/unit/skills.test.ts test/integration/session.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0ce330a`, 2026-06-20

## Why this matters

Validation is the last guard before Ritual mirrors a generated `SKILL.md` into
additional selected targets. The validator computes quality warnings, but the
interactive flow only prints errors, so users never see warnings about generic
or incomplete skills. Also, `agnix` is optional according to the docs, but a
nonzero `agnix validate` currently throws out of `validateSkillDraft` instead of
returning a structured validation issue and preserving built-in validation
results.

## Current state

- `src/skills/validate.ts` performs built-in validation and optionally calls
  `agnix`.
- `src/cli/interactive.ts` prints validation errors only.
- `test/unit/skills.test.ts` covers a valid draft and one invalid frontmatter
  case.
- `test/integration/session.test.ts` has a mock launcher and output capture for
  interactive flow tests.

Current relevant excerpts:

```ts
// src/cli/interactive.ts:196
const validation = await validateSkillDraft({ draftDir: primaryTarget.skillDir, fs, runner });
for (const error of validation.errors) {
  output.write(`[error] ${error.message}`);
}
if (validation.errors.length > 0) {
  return { status: "cancelled", reason: "Skill validation failed." };
}
```

```ts
// src/skills/validate.ts:87
if (GENERIC_PATTERN.test(body)) {
  warnings.push({ code: "generic-body", message: "Skill body appears generic." });
}
```

```ts
// src/skills/validate.ts:159
async function runAgnix(runner: CommandRunner | undefined, skillPath: string): Promise<boolean> {
  if (runner === undefined || (await runner.which("agnix")) === undefined) {
    return false;
  }
  await runner.run({ command: "agnix", args: ["validate", skillPath] });
  return true;
}
```

Documented requirement:

```md
docs/TECH_SPEC.md:335
Validation must separate blocking structural failures from quality warnings.
docs/TECH_SPEC.md:357
Use `agnix` when available. Built-in validation is required and must be sufficient for MVP operation when `agnix` is unavailable.
README.md:129
- Missing `agnix`: built-in validation still runs and is sufficient for MVP use.
```

Repo conventions to follow:

- Validation issues use `{ code, message }`.
- User-facing output in the interactive flow uses `[error] ...` style for
  errors; use `[warning] ...` for warnings.
- Tests use fake `CommandRunner` objects instead of invoking real binaries.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `bun run test -- test/unit/skills.test.ts` | skills tests pass |
| Integration tests | `bun run test -- test/integration/session.test.ts` | session tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format | `bun run check` | exit 0, no fixes applied |
| Full tests | `bun run test` | all tests pass |

## Scope

**In scope**:

- `src/skills/validate.ts`
- `src/cli/interactive.ts`
- `test/unit/skills.test.ts`
- `test/integration/session.test.ts`

**Out of scope**:

- Replacing the built-in validator with a YAML parser.
- Changing the generated skill prompt.
- Blocking on quality warnings; this plan only surfaces them.
- Writing or mirroring skill files differently.

## Git workflow

- Branch: `advisor/002-surface-validation-warnings`
- Commit message style: `fix: surface skill validation warnings`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add unit tests for warnings and agnix failure behavior

In `test/unit/skills.test.ts`, add tests under `describe("skill validation")`:

1. A draft with valid frontmatter and a body like `Do the task and be helpful.`
   should return no errors and warning codes `generic-body` and
   `missing-workflow-steps`.
2. A fake runner whose `which("agnix")` returns a path and whose `run(...)`
   rejects should not throw from `validateSkillDraft`. It should return built-in
   validation results plus a structured issue indicating that external `agnix`
   validation failed.

Choose whether the `agnix` failure is an error or warning before implementing.
Recommended behavior: make it an error when `agnix` is present and fails,
because the user has installed the stricter validator and it rejected the draft.
Keep the message stable and user-facing, without leaking stack traces.

**Verify**: `bun run test -- test/unit/skills.test.ts` fails before the code
change.

### Step 2: Return structured agnix validation results

Refactor `runAgnix` so it returns either:

- `{ available: false }`
- `{ available: true, issue: undefined }`
- `{ available: true, issue: ValidationIssue }`

Then merge that result into `validateSkillDraft`'s returned `errors` or
`warnings`, based on the decision from Step 1.

Do not let an `agnix` process failure throw out of `validateSkillDraft`.
Use a concise issue code such as `agnix-validation-failed`.

**Verify**: `bun run test -- test/unit/skills.test.ts` passes.

### Step 3: Print warnings in the interactive flow

In `src/cli/interactive.ts`, after printing validation errors, also print each
warning as:

```ts
output.write(`[warning] ${warning.message}`);
```

Warnings should not cancel the session. Keep cancellation tied to
`validation.errors.length > 0`.

Add or extend an integration test in `test/integration/session.test.ts` for the
fallback local write path, if such a path already exists by the time this plan is
executed. If not, add a unit-style interactive test with injected dependencies
that reaches validation and asserts warning output.

**Verify**: `bun run test -- test/integration/session.test.ts` passes.

### Step 4: Run repo checks

Run the standard gates.

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Add unit coverage for built-in warnings.
- Add unit coverage for present-but-failing `agnix`.
- Add interactive output coverage so warnings are visible to the user but do not
  block successful completion.

## Done criteria

- [ ] `validateSkillDraft` never throws solely because `agnix validate` failed.
- [ ] Present-but-failing `agnix` produces a structured validation issue.
- [ ] Interactive validation warnings are printed with `[warning]`.
- [ ] Warnings do not block mirroring when there are no errors.
- [ ] `bun run test -- test/unit/skills.test.ts` exits 0.
- [ ] `bun run test -- test/integration/session.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- `validateSkillDraft` has already been refactored and the excerpts above no
  longer match.
- The desired severity for `agnix` failure is ambiguous to the reviewer.
- Printing warnings requires changing public return types exported from
  `src/index.ts`.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Reviewers should verify the user sees enough validation feedback before a skill
is mirrored. Future validator additions should preserve the distinction between
blocking structural errors and non-blocking quality warnings.

