# Plan 001: Guard History Timestamp Conversion

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report - do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ce330a..HEAD -- src/history/parse-claude.ts src/history/parse-codex.ts test/unit/history.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0ce330a`, 2026-06-20

## Why this matters

Ritual's history parsers are supposed to handle malformed or partially written
history records without crashing. Today they check that timestamps are finite
numbers, but they do not check whether `Date` can represent the resulting time.
An out-of-range finite timestamp throws `RangeError: Invalid Date`, causing
`scanHistorySources` to treat the entire source file as unreadable and lose any
valid prompts from that file.

## Current state

- `src/history/parse-claude.ts` parses Claude prompt history records and
  converts millisecond timestamps.
- `src/history/parse-codex.ts` parses Codex prompt history records and converts
  second timestamps.
- `test/unit/history.test.ts` already contains parser and scan regression tests.

Current relevant excerpts:

```ts
// src/history/parse-claude.ts:70
function timestampToIsoString(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}
```

```ts
// src/history/parse-codex.ts:70
function timestampToIsoString(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value * 1000).toISOString();
}
```

```ts
// src/history/discover.ts:67
for (const source of sources) {
  try {
    const content = await readFile(source.path, "utf8");
    const parsed =
      source.kind === "claude"
        ? parseClaudeHistoryFile(source.path, content)
        : parseCodexHistoryFile(source.path, content);
```

Repo conventions to follow:

- Parser functions return diagnostics and skip bad records where practical
  instead of throwing through the scan.
- Tests use Vitest, fixture-free temporary files where needed, and direct parser
  calls for unit cases. Match `test/unit/history.test.ts`.
- Keep strict TypeScript settings satisfied; avoid `any`.

Documented requirement:

```md
docs/PRD.md:105
- Handle malformed or partially written history records without crashing.
docs/PRD.md:106
- Continue scanning other sources if one source fails.
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Tests | `bun run test -- test/unit/history.test.ts` | history tests pass |
| Full tests | `bun run test` | all tests pass |
| Lint/format | `bun run check` | exit 0, no fixes applied |

## Scope

**In scope**:

- `src/history/parse-claude.ts`
- `src/history/parse-codex.ts`
- `test/unit/history.test.ts`

**Out of scope**:

- Changing history discovery directory traversal.
- Changing extracted prompt IDs or source metadata.
- Adding dependencies for date parsing.

## Git workflow

- Branch: `advisor/001-guard-history-timestamps`
- Commit message style: conventional where it fits, for example
  `fix: skip invalid history timestamps`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add regression coverage for invalid finite timestamps

In `test/unit/history.test.ts`, add cases near the existing parser tests that
cover out-of-range finite timestamps for both Claude and Codex prompt history
records.

Use inputs like:

- Claude: `{ display: "review this workflow", timestamp: 1e20 }`
- Codex: `{ session_id: "bad", ts: 1e20, text: "review this workflow" }`

Expected behavior:

- The prompt is still extracted.
- `createdAt` is omitted.
- The parser does not throw.

Also add a scan-level regression under `describe("history scanning")` with a
single Codex file containing one bad-timestamp prompt and one valid prompt. The
scan should return both prompt texts and no `Failed to read history source`
diagnostic.

**Verify**: `bun run test -- test/unit/history.test.ts` should fail before the
code fix with a `RangeError` or failed expectation.

### Step 2: Make timestamp conversion total

In both parser files, change `timestampToIsoString` so it constructs the `Date`,
checks the resulting time with `Number.isNaN(date.getTime())`, and returns
`undefined` when the date is invalid.

For Codex, keep the existing seconds-to-milliseconds behavior. Only add the
representability guard.

Target shape:

```ts
const date = new Date(value);
return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
```

For Codex, use `new Date(value * 1000)`.

**Verify**: `bun run test -- test/unit/history.test.ts` passes.

### Step 3: Run repo checks

Run the standard gates for this narrow change.

**Verify**:

- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run test` exits 0.

## Test plan

- Add unit tests in `test/unit/history.test.ts` for invalid finite Claude and
  Codex timestamps.
- Add one scan-level regression that proves a bad timestamp does not turn into a
  source read failure.
- Existing parser tests in `test/unit/history.test.ts` are the structural
  pattern.

## Done criteria

- [ ] Invalid finite timestamps no longer throw in Claude or Codex parsers.
- [ ] Bad timestamps omit `createdAt` but preserve prompt text.
- [ ] `bun run test -- test/unit/history.test.ts` exits 0.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test` exit 0.
- [ ] No files outside the in-scope list and `plans/README.md` are modified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- The timestamp conversion code no longer matches the excerpts above.
- Fixing the bug appears to require changing `ExtractedPrompt` shape.
- The parser starts emitting new warnings for valid timestamps.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Reviewers should look for total parser behavior: malformed input should not make
the parser throw. If future history formats add numeric timestamps in different
units, add unit-specific guards rather than weakening these parser tests.

