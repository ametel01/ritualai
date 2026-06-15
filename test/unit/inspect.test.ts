import { inspectAction } from "../../src/cli/commands/inspect.js";
import type { PromptAdapter } from "../../src/cli/prompts.js";
import type { Diagnostic } from "../../src/diagnostics/types.js";
import type { InspectOutput, InspectScope } from "../../src/scan/types.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/system/exec.js";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "stable-props",
    severity: "error",
    title: "Avoid unstable props",
    message: "A component receives unstable props.",
    help: "Memoize the value or move it outside render.",
    line: 10,
    column: 3,
    category: "Performance",
    ...overrides,
  };
}

function inspectOutput(overrides: Partial<InspectOutput> = {}): InspectOutput {
  return {
    diagnostics: [diagnostic()],
    score: 82,
    project: {
      rootDirectory: "/repo",
      name: "example-app",
      hasDoctorScript: false,
    },
    didLintFail: false,
    didDeadCodeFail: false,
    baselineDegraded: false,
    ...overrides,
  };
}

const quietPrompts: PromptAdapter = {
  async confirm(): Promise<boolean> {
    throw new Error("prompt was not expected");
  },
  async input(): Promise<string> {
    throw new Error("prompt was not expected");
  },
  async select<Value extends string>(): Promise<Value> {
    throw new Error("prompt was not expected");
  },
  async checkbox<Value extends string>(): Promise<Value[]> {
    throw new Error("prompt was not expected");
  },
};

const runner: CommandRunner = {
  async which(): Promise<string | undefined> {
    return undefined;
  },
  async run(_invocation: CommandInvocation): Promise<CommandResult> {
    throw new Error("not used");
  },
};

describe("inspect action", () => {
  it("writes machine-readable JSON and skips prompts in JSON mode", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    const result = await inspectAction(
      ".",
      { json: true },
      {
        cwd: "/repo",
        prompts: quietPrompts,
        runner,
        output: {
          stdout: (message) => stdout.push(message),
          stderr: (message) => stderr.push(message),
        },
        setExitCode: (code) => exitCodes.push(code),
        now: () => 100,
        async runInspect(input: {
          directory: string;
          scope: InspectScope;
        }): Promise<InspectOutput> {
          expect(input).toEqual({ directory: "/repo", scope: "full" });
          return inspectOutput();
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(exitCodes).toEqual([1]);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}")).toMatchObject({
      status: "ok",
      score: 82,
      diagnostics: [{ rule: "stable-props" }],
    });
  });

  it("writes only the score and does not set a CI failure in score mode", async () => {
    const stdout: string[] = [];
    const exitCodes: number[] = [];

    const result = await inspectAction(
      ".",
      { score: true },
      {
        cwd: "/repo",
        prompts: quietPrompts,
        runner,
        output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
        setExitCode: (code) => exitCodes.push(code),
        async runInspect(): Promise<InspectOutput> {
          return inspectOutput();
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(exitCodes).toEqual([]);
    expect(stdout).toEqual(["82"]);
  });

  it("does not fail CI when baseline attribution degraded", async () => {
    const exitCodes: number[] = [];

    const result = await inspectAction(
      ".",
      { diff: true },
      {
        cwd: "/repo",
        stdinIsTty: false,
        stdoutIsTty: false,
        prompts: quietPrompts,
        runner,
        output: { stdout: () => undefined, stderr: () => undefined },
        setExitCode: (code) => exitCodes.push(code),
        async runInspect(input): Promise<InspectOutput> {
          expect(input.scope).toBe("changed");
          return inspectOutput({ baselineDegraded: true });
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(exitCodes).toEqual([]);
  });

  it("prints the coding-agent install hint instead of prompting", async () => {
    const stderr: string[] = [];

    await inspectAction(
      ".",
      {},
      {
        cwd: "/repo",
        env: { CODEX_SANDBOX: "1" },
        prompts: quietPrompts,
        runner,
        output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
        setExitCode: () => undefined,
        async runInspect(): Promise<InspectOutput> {
          return inspectOutput();
        },
      },
    );

    expect(stderr.join("\n")).toContain("npx react-doctor install --yes");
  });
});
