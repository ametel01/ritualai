import { formatDiagnostics, formatSourceSummary } from "../../src/telemetry/diagnostics.js";

describe("telemetry formatting", () => {
  it("groups repeated no-prompt warnings into a friendly summary", () => {
    const lines = formatDiagnostics([
      {
        level: "warning",
        message: "No user prompts found in supported Codex records.",
        sourcePath: "/tmp/one.jsonl",
      },
      {
        level: "warning",
        message: "No user prompts found in supported Codex records.",
        sourcePath: "/tmp/two.jsonl",
      },
    ]);

    expect(lines).toEqual([
      "[warning] 2 Codex history files did not contain reusable user prompts, so Ritual skipped them. Examples: /tmp/one.jsonl, /tmp/two.jsonl",
    ]);
  });

  it("summarizes scanned sources by history type", () => {
    const lines = formatSourceSummary([
      {
        source: { kind: "codex", path: "/tmp/one.jsonl" },
        prompts: [{ id: "1", source: "codex", sourcePath: "/tmp/one.jsonl", text: "review this" }],
        diagnostics: [],
      },
      {
        source: { kind: "codex", path: "/tmp/two.jsonl" },
        prompts: [],
        diagnostics: [],
      },
    ]);

    expect(lines).toEqual(["Scanned 2 codex history files and found 1 user prompt."]);
  });
});
