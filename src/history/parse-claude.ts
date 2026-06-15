import { parseRecords, promptFromRecord, toExtractedPrompts } from "./parse-shared.js";
import type { Diagnostic } from "./types.js";

type ClaudePromptHistoryRecord = {
  display?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
};

export function parseClaudeHistoryFile(
  sourcePath: string,
  content: string,
): {
  prompts: ReturnType<typeof toExtractedPrompts>;
  diagnostics: Diagnostic[];
} {
  const parsed = parseRecords(content, sourcePath);
  const candidates = parsed.records
    .map((record) => promptFromRecord(record.value) ?? promptFromClaudeHistoryRecord(record.value))
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

function promptFromClaudeHistoryRecord(record: unknown):
  | {
      text: string;
      sessionId?: string;
      createdAt?: string;
    }
  | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  const historyRecord = record as ClaudePromptHistoryRecord;
  const text = stringValue(historyRecord.display);
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }

  const sessionId = stringValue(historyRecord.sessionId);
  const createdAt = timestampToIsoString(historyRecord.timestamp);

  return {
    text: text.trim(),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function timestampToIsoString(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
