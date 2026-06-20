import { access, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runInteractiveSession } from "../../src/cli/interactive.js";
import type { PromptAdapter } from "../../src/cli/prompts.js";
import type {
  CommandInvocation,
  CommandLauncher,
  CommandResult,
  CommandRunner,
} from "../../src/system/exec.js";
import { nodeFileSystem } from "../../src/system/filesystem.js";

class QueuePrompts implements PromptAdapter {
  readonly confirms: boolean[];
  readonly inputs: string[];
  readonly selects: string[];
  readonly checkboxes: string[][];
  readonly selectMessages: string[] = [];

  constructor(options: {
    confirms: boolean[];
    inputs: string[];
    selects: string[];
    checkboxes: string[][];
  }) {
    this.confirms = [...options.confirms];
    this.inputs = [...options.inputs];
    this.selects = [...options.selects];
    this.checkboxes = [...options.checkboxes];
  }

  async confirm(): Promise<boolean> {
    const value = this.confirms.shift();
    if (value === undefined) {
      throw new Error("Missing confirm answer.");
    }
    return value;
  }

  async input(): Promise<string> {
    const value = this.inputs.shift();
    if (value === undefined) {
      throw new Error("Missing input answer.");
    }
    return value;
  }

  async select<Value extends string>(message: string): Promise<Value> {
    this.selectMessages.push(message);
    const value = this.selects.shift();
    if (value === undefined) {
      throw new Error("Missing select answer.");
    }
    return value as Value;
  }

  async checkbox<Value extends string>(): Promise<Value[]> {
    const value = this.checkboxes.shift();
    if (value === undefined) {
      throw new Error("Missing checkbox answer.");
    }
    return value as Value[];
  }
}

class MockRunner implements CommandRunner {
  async which(command: string): Promise<string | undefined> {
    return command === "claude" ? "/usr/local/bin/claude" : undefined;
  }

  async run(_invocation: CommandInvocation): Promise<CommandResult> {
    throw new Error("not used");
  }
}

class MockLauncher implements CommandLauncher {
  invocations: Array<{ invocation: CommandInvocation; cwd: string }> = [];

  constructor(private readonly skillPath: string) {}

  async launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number> {
    this.invocations.push({ invocation, cwd: options.cwd });
    const prompt = invocation.args.at(-1) ?? "";
    if (prompt.includes("selected local agent window")) {
      return 0;
    }
    await nodeFileSystem.writeTextAtomic(
      this.skillPath,
      [
        "---",
        "name: pr-review-workflow",
        "description: Use when reviewing TypeScript pull requests for correctness, CI risk, and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the changed files and identify behavior changes.",
        "- Check package scripts, tests, and CI expectations.",
        "- Report findings with file references and concrete fixes.",
      ].join("\n"),
    );
    return 0;
  }
}

describe("interactive session", () => {
  it("runs the happy path without touching real history or skill roots", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "history",
      "codex-repeat.jsonl",
    );
    const runner = new MockRunner();
    const claudePath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    const launcher = new MockLauncher(claudePath);
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, true],
      inputs: [fixturePath],
      selects: ["codex", "claude"],
      checkboxes: [],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher,
    });

    expect(result).toEqual({ status: "handed-off", executable: "claude" });
    expect(launcher.invocations).toHaveLength(1);
    expect(launcher.invocations[0]?.invocation.command).toBe("claude");
    expect(launcher.invocations[0]?.invocation.args[0]).toBe("--dangerously-skip-permissions");
    expect(launcher.invocations[0]?.invocation.args.at(-1)).toContain(
      "You are running inside the user's selected local agent window.",
    );
    expect(launcher.invocations[0]?.invocation.args.at(-1)).toContain(
      "Ask the user which skill or skills they want to implement.",
    );
    expect(launcher.invocations[0]?.cwd).toBe(cwd);

    await expect(access(claudePath)).rejects.toThrow();
    await expect(access(path.join(cwd, ".ritual"))).rejects.toThrow();
    expect(outputs.some((line) => line.includes("found 3 user prompts"))).toBe(true);
    expect(
      outputs.some((line) => line.includes("present a table, and ask what to implement")),
    ).toBe(true);
    expect(outputs.some((line) => line.toLowerCase().includes("draft"))).toBe(false);
  });

  it("skips repeated workflows already covered by existing skills", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "history",
      "codex-repeat.jsonl",
    );
    await nodeFileSystem.writeTextAtomic(
      path.join(cwd, ".claude", "skills", "review-this-typescript-missing", "SKILL.md"),
      [
        "---",
        "name: review-this-typescript-missing",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "Inspect changed files, check tests, and report concrete pull request findings.",
      ].join("\n"),
    );

    const runner = new MockRunner();
    const launcher = new MockLauncher(path.join(cwd, "unused", "SKILL.md"));
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, false],
      inputs: [fixturePath],
      selects: ["codex"],
      checkboxes: [],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher,
    });

    expect(result).toEqual({ status: "cancelled", reason: "No candidate was approved." });
    expect(launcher.invocations).toEqual([]);
    expect(outputs).toContain("Skipped 1 repeated workflow already covered by existing skills.");
  });

  it("can use agent discovery when local prompt extraction finds no prompts", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const historyPath = path.join(cwd, "unsupported-but-readable.jsonl");
    await writeFile(historyPath, `${JSON.stringify({ type: "metadata", value: "no prompt" })}\n`);

    const runner = new MockRunner();
    const claudePath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    const launcher = new MockLauncher(claudePath);
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, true],
      inputs: [historyPath],
      selects: ["codex", "claude"],
      checkboxes: [],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher,
    });

    expect(result).toEqual({ status: "handed-off", executable: "claude" });
    expect(launcher.invocations).toHaveLength(1);
    expect(launcher.invocations[0]?.invocation.args.at(-1)).toContain(
      "You are running inside the user's selected local agent window.",
    );
    await expect(access(claudePath)).rejects.toThrow();
    await expect(access(path.join(cwd, ".ritual"))).rejects.toThrow();
  });
});
