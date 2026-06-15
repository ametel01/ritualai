import type { SessionResult } from "../../src/cli/interactive.js";
import { normalizeHelpInvocation, runCli } from "../../src/cli/runtime.js";

describe("cli runtime", () => {
  it("normalizes help to --help", () => {
    expect(normalizeHelpInvocation(["help"])).toEqual(["--help"]);
  });

  it("preserves the no-flags public command contract", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    await runCli({
      argv: ["node", "ritual", "--json"],
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      stdin: undefined,
      async runInteractive(): Promise<SessionResult> {
        throw new Error("interactive session should not run");
      },
    });

    expect(stderr).toEqual(["Ritual MVP has one interactive command and no subcommands or flags."]);
    expect(exitCodes).toEqual([1]);
  });

  it("runs the interactive session with no args", async () => {
    const stdout: string[] = [];

    await runCli({
      argv: ["node", "ritual"],
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: () => undefined,
      stdin: undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });

    expect(stdout).toEqual(["Ritual stopped: done"]);
  });
});
