import type { Diagnostic, SourceScanResult } from "../history/types.js";

export function formatDiagnostics(diagnostics: Diagnostic[]): string[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.level}:${diagnostic.message}`;
    groups.set(key, [...(groups.get(key) ?? []), diagnostic]);
  }

  return [...groups.values()].map(formatDiagnosticGroup);
}

export function formatSourceSummary(sources: SourceScanResult[]): string[] {
  if (sources.length === 0) {
    return ["No supported history sources were scanned."];
  }
  const byKind = new Map<string, SourceScanResult[]>();
  for (const source of sources) {
    byKind.set(source.source.kind, [...(byKind.get(source.source.kind) ?? []), source]);
  }

  return [...byKind.entries()].map(([kind, results]) => {
    const fileCount = results.length;
    const promptCount = results.reduce((total, result) => total + result.prompts.length, 0);
    return `Scanned ${fileCount} ${kind} history file${fileCount === 1 ? "" : "s"} and found ${promptCount} user prompt${promptCount === 1 ? "" : "s"}.`;
  });
}

function formatDiagnosticGroup(group: Diagnostic[]): string {
  const first = group[0];
  if (first === undefined) {
    return "";
  }
  if (group.length === 1) {
    const location = first.sourcePath === undefined ? "" : ` ${first.sourcePath}`;
    return `[${first.level}]${location} ${first.message}`;
  }

  return `[${first.level}] ${friendlyGroupedMessage(first.message, group)}`;
}

function friendlyGroupedMessage(message: string, group: Diagnostic[]): string {
  const count = group.length;
  const examples = group
    .map((diagnostic) => diagnostic.sourcePath)
    .filter((sourcePath): sourcePath is string => sourcePath !== undefined)
    .slice(0, 3);
  const exampleText =
    examples.length === 0
      ? ""
      : ` Examples: ${examples.join(", ")}${count > examples.length ? ", ..." : ""}`;

  if (message === "No user prompts found in supported Codex records.") {
    return `${count} Codex history files did not contain reusable user prompts, so Ritual skipped them.${exampleText}`;
  }
  if (message === "No user prompts found in supported Claude records.") {
    return `${count} Claude history files did not contain reusable user prompts, so Ritual skipped them.${exampleText}`;
  }
  if (message === "History file is empty.") {
    return `${count} history files were empty, so Ritual skipped them.${exampleText}`;
  }

  return `${count} files reported: ${message}${exampleText}`;
}
