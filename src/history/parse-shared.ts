import type { Diagnostic, ExtractedPrompt, HistorySourceKind } from "./types.js";

type ParsedRecord = {
  value: unknown;
  line?: number;
};

type PromptCandidate = {
  text: string;
  sessionId?: string;
  createdAt?: string;
};

export type ParseResult = {
  prompts: ExtractedPrompt[];
  diagnostics: Diagnostic[];
};

export function parseRecords(
  content: string,
  sourcePath: string,
): {
  records: ParsedRecord[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return {
      records: [],
      diagnostics: [{ level: "warning", message: "History file is empty.", sourcePath }],
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { records: parsed.map((value) => ({ value })), diagnostics };
    }
    return { records: [{ value: parsed }], diagnostics };
  } catch {
    const records: ParsedRecord[] = [];
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const lineText = line.trim();
      if (lineText.length === 0) {
        continue;
      }
      try {
        records.push({ value: JSON.parse(lineText) as unknown, line: lineNumber });
      } catch {
        diagnostics.push({
          level: "warning",
          message: `Malformed JSON record at line ${lineNumber}.`,
          sourcePath,
        });
      }
    }
    if (records.length === 0) {
      diagnostics.push({
        level: "error",
        message: "No supported JSON or JSONL records found.",
        sourcePath,
      });
    }
    return { records, diagnostics };
  }
}

export function promptFromRecord(record: unknown): PromptCandidate | undefined {
  if (!isRecord(record) || !isUserRecord(record)) {
    return undefined;
  }

  const text = contentToText(
    firstKnownValue(record, ["content", "message", "prompt", "text", "input"]),
  );
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }

  const sessionId = stringValue(
    firstKnownValue(record, ["sessionId", "session_id", "conversation_id"]),
  );
  const createdAt = stringValue(
    firstKnownValue(record, ["createdAt", "created_at", "timestamp", "time"]),
  );

  return {
    text: text.trim(),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

export function toExtractedPrompts(params: {
  candidates: PromptCandidate[];
  source: HistorySourceKind;
  sourcePath: string;
  prefix: string;
}): ExtractedPrompt[] {
  return params.candidates.map((candidate, index) => ({
    id: `${params.prefix}:${index + 1}`,
    source: params.source,
    sourcePath: params.sourcePath,
    text: candidate.text,
    ...(candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId }),
    ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt }),
  }));
}

function isUserRecord(record: Record<string, unknown>): boolean {
  const directRole = stringValue(firstKnownValue(record, ["role", "type", "kind", "author"]));
  if (directRole !== undefined && directRole.toLowerCase() === "user") {
    return true;
  }

  const message = firstKnownValue(record, ["message", "event"]);
  if (isRecord(message)) {
    const nestedRole = stringValue(firstKnownValue(message, ["role", "type", "kind", "author"]));
    return nestedRole !== undefined && nestedRole.toLowerCase() === "user";
  }

  return false;
}

function contentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value)) {
    const role = stringValue(firstKnownValue(value, ["role", "type"]));
    if (role !== undefined && role.toLowerCase() !== "user" && role.toLowerCase() !== "text") {
      return undefined;
    }
    return contentToText(firstKnownValue(value, ["content", "text", "input"]));
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => contentPartToText(item))
      .filter((item): item is string => item !== undefined && item.trim().length > 0);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join("\n");
  }

  return undefined;
}

function contentPartToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const type = stringValue(firstKnownValue(value, ["type"]));
  if (type !== undefined && !["text", "input_text", "user"].includes(type.toLowerCase())) {
    return undefined;
  }
  return stringValue(firstKnownValue(value, ["text", "content", "input"]));
}

function firstKnownValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
