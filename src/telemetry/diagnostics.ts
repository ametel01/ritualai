import type { Diagnostic, SourceScanResult } from "../history/types.js";

export function formatDiagnostics(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.sourcePath === undefined ? "" : ` ${diagnostic.sourcePath}`;
    return `[${diagnostic.level}]${location} ${diagnostic.message}`;
  });
}

export function formatSourceSummary(sources: SourceScanResult[]): string[] {
  if (sources.length === 0) {
    return ["No supported history sources were scanned."];
  }
  return sources.map(
    (source) =>
      `${source.source.kind}: ${source.prompts.length} user prompts extracted from ${source.source.path}`,
  );
}
