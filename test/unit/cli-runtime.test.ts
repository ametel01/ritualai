import { EventEmitter } from "node:events";
import type { SessionResult } from "../../src/cli/interactive.js";
import { normalizeHelpInvocation, type RuntimeStdin, runCli } from "../../src/cli/runtime.js";

class FakeStdin extends EventEmitter implements RuntimeStdin {
  unrefCalls = 0;

  unref(): this {
    this.unrefCalls += 1;
    return this;
  }
}

describe("cli runtime", () => {
  it("normalizes bare help before argument handling", () => {
    expect(normalizeHelpInvocation(["help"])).toEqual(["--help"]);
  });

  it("preserves Ritual's one-command, no-flags public contract", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const stdin = new FakeStdin();

    await runCli({
      argv: ["node", "ritual", "--json"],
      stdin,
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        throw new Error("interactive session should not run");
      },
    });

    expect(stdin.unrefCalls).toBe(1);
    expect(stderr).toEqual(["Ritual has one interactive command and no subcommands or flags."]);
    expect(exitCodes).toEqual([1]);
  });

  it("runs the interactive session when no args are supplied", async () => {
    const stdout: string[] = [];

    await runCli({
      argv: ["node", "ritual"],
      stdin: new FakeStdin(),
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });

    expect(stdout).toEqual(["Ritual stopped: done"]);
  });

  it("funnels unexpected top-level errors through a stable Ritual message", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    await runCli({
      argv: ["node", "ritual"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        throw new Error("boom");
      },
    });

    expect(stderr).toEqual(["Ritual failed: boom"]);
    expect(exitCodes).toEqual([1]);
  });
});
