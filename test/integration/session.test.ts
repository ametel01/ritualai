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
  readonly skillPath: string;
  readonly skillContent: string;

  constructor(
    skillPath: string,
    skillContent: string = [
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
  ) {
    this.skillPath = skillPath;
    this.skillContent = skillContent;
  }

  invocations: Array<{ invocation: CommandInvocation; cwd: string }> = [];

  async launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number> {
    this.invocations.push({ invocation, cwd: options.cwd });
    const prompt = invocation.args.at(-1) ?? "";
    if (prompt.includes("selected local agent window")) {
      return 0;
    }
    await nodeFileSystem.writeTextAtomic(this.skillPath, this.skillContent);
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

  it("continues local fallback on validation warnings and writes the generated SKILL.md", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const historyPath = path.join(homeDir, "history.jsonl");
    const basePrompts = [
      "review dependency updates in changelog and patch files",
      "review dependency updates in changelog and patch files now",
      "review dependency updates in changelog and patch files carefully",
    ];
    await writeFile(
      historyPath,
      basePrompts
        .map((prompt, index) =>
          JSON.stringify({
            session_id: `session-${index + 1}`,
            ts: 1775423768 + index,
            text: prompt,
          }),
        )
        .join("\n"),
      "utf8",
    );

    const runner = new MockRunner();
    const warningLauncher = new MockLauncher(
      path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md"),
      [
        "---",
        "name: pr-review-workflow",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "Do the task and be helpful.",
      ].join("\n"),
    );
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, false],
      inputs: [historyPath, "pr-review-workflow"],
      selects: ["codex", "candidate-1", "project", "claude"],
      checkboxes: [["claude"]],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher: warningLauncher,
    });

    expect(result).toEqual({
      status: "completed",
      writtenPaths: [path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md")],
      skillPath: path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md"),
    });
    expect(warningLauncher.invocations).toHaveLength(1);
    expect(
      outputs.some((line) => line.includes("Using Ritual's local repeated-workflow ranking.")),
    ).toBe(true);
    expect(outputs.some((line) => line.includes("[warning] Skill body appears generic."))).toBe(
      true,
    );
    expect(
      outputs.some((line) =>
        line.includes("[warning] Skill body does not appear to include concrete workflow steps."),
      ),
    ).toBe(true);
    await expect(access(warningLauncher.skillPath)).resolves.toBeUndefined();
  });

  it("mirrors generated skills to all selected output ecosystems", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const historyPath = path.join(homeDir, "history.jsonl");
    await writeFile(
      historyPath,
      [
        JSON.stringify({
          session_id: "session-1",
          ts: 1775423768,
          text: "review dependency updates in changelog and patch files",
        }),
        JSON.stringify({
          session_id: "session-2",
          ts: 1775423780,
          text: "review dependency updates in changelog and patch files now",
        }),
        JSON.stringify({
          session_id: "session-3",
          ts: 1775423790,
          text: "review dependency updates in changelog and patch files carefully",
        }),
      ].join("\n"),
      "utf8",
    );

    const claudePath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    const codexPath = path.join(cwd, ".agents", "skills", "pr-review-workflow", "SKILL.md");
    const skillContent = [
      "---",
      "name: pr-review-workflow",
      "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
      "---",
      "",
      "## Workflow",
      "",
      "- Inspect the changed files and identify behavior changes.",
      "- Check package scripts, tests, and CI expectations.",
      "- Report findings with file references and concrete fixes.",
    ].join("\n");
    const launcher = new MockLauncher(claudePath, skillContent);
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, false],
      inputs: [historyPath, "pr-review-workflow"],
      selects: ["codex", "candidate-1", "project", "claude"],
      checkboxes: [["claude", "codex"]],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner: new MockRunner(),
      launcher,
    });

    expect(result).toEqual({
      status: "completed",
      writtenPaths: [claudePath, codexPath],
      skillPath: claudePath,
    });
    expect(launcher.invocations).toHaveLength(1);
    expect(await nodeFileSystem.readText(claudePath)).toBe(skillContent);
    expect(await nodeFileSystem.readText(codexPath)).toBe(skillContent);
    expect(outputs.some((line) => line.includes(`Wrote ${codexPath}`))).toBe(true);
  });

  it("cancels when an existing output target overwrite is declined", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const historyPath = path.join(homeDir, "history.jsonl");
    const skillPath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    await writeFile(
      historyPath,
      [
        JSON.stringify({
          session_id: "session-1",
          ts: 1775423768,
          text: "review dependency updates",
        }),
        JSON.stringify({
          session_id: "session-2",
          ts: 1775423780,
          text: "review dependency updates now",
        }),
        JSON.stringify({
          session_id: "session-3",
          ts: 1775423790,
          text: "review dependency updates carefully",
        }),
      ].join("\n"),
      "utf8",
    );
    await nodeFileSystem.writeTextAtomic(
      skillPath,
      "---\nname: pr-review-workflow\n---\nExisting content\n",
    );
    const launcher = new MockLauncher(
      skillPath,
      [
        "---",
        "name: pr-review-workflow",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the changed files and identify behavior changes.",
      ].join("\n"),
    );
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, false, false],
      inputs: [historyPath, "pr-review-workflow"],
      selects: ["codex", "candidate-1", "project", "claude"],
      checkboxes: [["claude"]],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner: new MockRunner(),
      launcher,
    });

    expect(result).toEqual({
      status: "cancelled",
      reason: "Target write was not approved.",
    });
    expect(launcher.invocations).toHaveLength(0);
    expect(await nodeFileSystem.readText(skillPath)).toBe(
      "---\nname: pr-review-workflow\n---\nExisting content\n",
    );
  });
});
