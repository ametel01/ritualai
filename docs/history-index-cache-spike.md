# History Index/Cache Spike

## Problem

History scanning currently re-parses local JSON and JSONL files every run. That is bounded by file-count and file-size caps, but large local histories still require repeated work across commands.

## Current behavior

Ritual:

- Discovers supported Claude and Codex history paths on every run.
- Reads each supported file into memory.
- Parses and filters prompts into candidate artifacts.
- Deduplicates and sorts candidate prompts.

The implementation is privacy-preserving and ephemeral by default, but it can still feel slow on large local histories.

## Privacy constraints

- Local history is sensitive developer data.
- History and extracted prompts should remain local by default.
- Persisted artifacts should avoid storing private prompt content unless the user opts in.
- Any persisted artifact must have a clear delete path and transparent retention behavior.

## Options

### No cache; bounded scans only

- Keep current behavior and rely on `maxFilesPerRoot` plus `maxFileBytes`.
- Performance improves with smaller source shapes and cleaner history files.
- Privacy posture is strongest because no additional persistent state is introduced.
- Invalidation is simple because behavior is always a direct re-scan.
- Failure mode is mostly bounded slowness on very large histories.

### Metadata-only index

- Store only file-level metadata (path, extension, size, modified time, parse status, last scan timestamp).
- Improve discovery by skipping unchanged files quickly; parse only files likely to change.
- Privacy risk is low because no prompt text is persisted.
- Invalidation ties to `mtime`/size plus a checksum for suspiciously unstable file systems.
- Failure mode is stale cache if timestamps are misleading or clocks skew; fallback is to trigger full reparsing and rebuild index entries.

### Prompt summary cache

- Persist extracted prompt metadata or normalized summary fields to avoid reparsing entire files.
- Significant speedup potential for repeated prompt-dump and ranking invocations.
- Privacy risk is materially higher because workflow content is still derivable from cache.
- Invalidation must include file digest, parser version, and cache schema version.
- Failure mode is stale or over-privileged cache reuse across repositories and workspaces.

## Recommendation

- Ship with bounded scans only.
- Keep prompt-text persistence out of scope.
- If a cache is later introduced, start with metadata-only entries only.
- Require explicit user-visible opt-in for any cache that persists derived prompt information.
- Expose cache-clear and cache-staleness diagnostics so users can recover from drift.

## Non-goals

- Introducing semantic search or embedding indexes in the MVP.
- Changing default scan behavior from best-effort local parsing.
- Syncing cache state to remote services.
- Persisting prompt text for default workflow ranking.

## Open questions

- Should the index be per-repository or global?
- Which fields are required to safely invalidate without parsing payloads?
- Should users be able to disable the index entirely at runtime?
- How should index write failures be surfaced without blocking `prompts` and interactive fallbacks?

## Acceptance criteria for a future implementation

- A clear `history.index.json` schema is defined and versioned.
- Tests cover stale cache recovery, corruption handling, and user opt-out.
- Cache reads never raise the runtime permissions surface beyond existing history reads.
- Default behavior remains privacy-first and local-only.
- A documented migration path exists for users who opt in to cache mode and later disable it.
