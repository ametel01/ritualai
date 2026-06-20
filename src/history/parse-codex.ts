import { parseRecords, promptFromRecord, toExtractedPrompts } from "./parse-shared.js";
import type { Diagnostic } from "./types.js";

type CodexPromptHistoryRecord = {
  text?: unknown;
  session_id?: unknown;
  ts?: unknown;
};

export function parseCodexHistoryFile(
  sourcePath: string,
  content: string,
): {
  prompts: ReturnType<typeof toExtractedPrompts>;
  diagnostics: Diagnostic[];
} {
  const parsed = parseRecords(content, sourcePath);
  const candidates = parsed.records
    .map((record) => promptFromRecord(record.value) ?? promptFromCodexHistoryRecord(record.value))
    .filter((prompt): prompt is NonNullable<typeof prompt> => prompt !== undefined);

  return {
    prompts: toExtractedPrompts({
      candidates,
      source: "codex",
      sourcePath,
      prefix: `codex:${sourcePath}`,
    }),
    diagnostics:
      candidates.length === 0
        ? [
            ...parsed.diagnostics,
            {
              level: "warning",
              message: "No user prompts found in supported Codex records.",
              sourcePath,
            },
          ]
        : parsed.diagnostics,
  };
}

function promptFromCodexHistoryRecord(record: unknown):
  | {
      text: string;
      sessionId?: string;
      createdAt?: string;
    }
  | undefined {
  if (!isRecord(record)) {
    return undefined;
  }

  const historyRecord = record as CodexPromptHistoryRecord;
  const text = stringValue(historyRecord.text);
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }

  const sessionId = stringValue(historyRecord.session_id);
  const createdAt = timestampToIsoString(historyRecord.ts);

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
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
