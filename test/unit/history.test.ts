import { parseClaudeHistoryFile } from "../../src/history/parse-claude.js";
import { parseCodexHistoryFile } from "../../src/history/parse-codex.js";

describe("history parsers", () => {
  it("extracts only user prompts from Claude JSONL records", () => {
    const result = parseClaudeHistoryFile(
      "/tmp/claude.jsonl",
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "write tests" } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" } }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "fix lint" }] },
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual(["write tests", "fix lint"]);
    expect(result.prompts.every((prompt) => prompt.source === "claude")).toBe(true);
  });

  it("extracts only user prompts from Codex records and reports malformed lines", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "review this" }] }),
        JSON.stringify({ role: "assistant", content: "not included" }),
        "not-json",
      ].join("\n"),
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]?.text).toBe("review this");
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Malformed"))).toBe(
      true,
    );
  });

  it("extracts user prompts from Codex response_item payload envelopes", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex-real.jsonl",
      [
        JSON.stringify({
          timestamp: "2026-06-14T17:43:53.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [
              { type: "input_text", text: "<skills_instructions>internal</skills_instructions>" },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-14T17:43:54.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /tmp/project\n<INSTRUCTIONS>internal</INSTRUCTIONS>",
              },
              {
                type: "input_text",
                text: "<environment_context><cwd>/tmp/project</cwd></environment_context>",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-14T17:43:55.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "not included" }],
          },
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
    ]);
    expect(result.prompts[0]?.createdAt).toBe("2026-06-14T17:43:55.000Z");
    expect(result.diagnostics).toEqual([]);
  });
});
