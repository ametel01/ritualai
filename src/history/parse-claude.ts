import { parseRecords, promptFromRecord, toExtractedPrompts } from "./parse-shared.js";
import type { Diagnostic } from "./types.js";

export function parseClaudeHistoryFile(
  sourcePath: string,
  content: string,
): {
  prompts: ReturnType<typeof toExtractedPrompts>;
  diagnostics: Diagnostic[];
} {
  const parsed = parseRecords(content, sourcePath);
  const candidates = parsed.records
    .map((record) => promptFromRecord(record.value))
    .filter((prompt): prompt is NonNullable<typeof prompt> => prompt !== undefined);

  return {
    prompts: toExtractedPrompts({
      candidates,
      source: "claude",
      sourcePath,
      prefix: `claude:${sourcePath}`,
    }),
    diagnostics:
      candidates.length === 0
        ? [
            ...parsed.diagnostics,
            {
              level: "warning",
              message: "No user prompts found in supported Claude records.",
              sourcePath,
            },
          ]
        : parsed.diagnostics,
  };
}
