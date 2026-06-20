import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtractedPrompt } from "../../src/history/types.js";
import {
  buildAgentDiscoveryHandoffPrompt,
  launchAgentDiscoverySession,
} from "../../src/skills/agent-discovery.js";
import { buildDraftInvocation, detectDraftExecutables } from "../../src/skills/draft.js";
import { filterCoveredCandidates } from "../../src/skills/duplicates.js";
import { buildGenerationHandoffPrompt } from "../../src/skills/generation-template.js";
import { resolveSkillTargets, sanitizeSkillName } from "../../src/skills/paths.js";
import { validateSkillDraft } from "../../src/skills/validate.js";
import type {
  CommandInvocation,
  CommandLauncher,
  CommandResult,
  CommandRunner,
} from "../../src/system/exec.js";
import { nodeFileSystem } from "../../src/system/filesystem.js";

function prompt(id: string, text: string): ExtractedPrompt {
  return { id, source: "codex", sourcePath: "/tmp/history.jsonl", text };
}

describe("skill paths", () => {
  it("sanitizes names and prevents path traversal", () => {
    expect(sanitizeSkillName("../Review PR!!")).toBe("review-pr");
  });

  it("resolves project-local target paths for both ecosystems", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-paths-"));
    const targets = await resolveSkillTargets({
      cwd,
      homeDir: cwd,
      name: "review-pr",
      scope: "project",
      ecosystems: ["claude", "codex"],
    });

    expect(targets.map((target) => path.relative(cwd, target.skillPath))).toEqual([
      path.join(".claude", "skills", "review-pr", "SKILL.md"),
      path.join(".agents", "skills", "review-pr", "SKILL.md"),
    ]);
  });
});

describe("skill duplicate detection", () => {
  it("filters candidates already covered by existing skills", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-dupes-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-dupes-home-"));
    await mkdir(path.join(cwd, ".claude", "skills", "commit-all-changes-logically"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, ".claude", "skills", "commit-all-changes-logically", "SKILL.md"),
      [
        "---",
        "name: commit-all-changes-logically",
        "description: Use when asked to commit all current changes in one logical Git commit.",
        "---",
        "",
        "Inspect git status, review unstaged changes, stage intentionally, validate, and commit.",
      ].join("\n"),
    );

    const candidate = {
      id: "candidate-1",
      name: "commit-all-changes-logically",
      summary: "commit all unstaged changes in a single commit",
      prompts: [],
      representativePrompts: [prompt("prompt-1", "commit all unstaged changes in a single commit")],
      count: 3,
      coherence: 1,
      rankScore: 10,
      rankReason: "Repeated commit workflow.",
      isStrong: true,
    };

    const result = await filterCoveredCandidates([candidate], {
      cwd,
      homeDir,
      scope: "project",
      ecosystems: ["claude", "codex"],
      fs: nodeFileSystem,
    });

    expect(result.available).toEqual([]);
    expect(result.covered[0]?.skill.name).toBe("commit-all-changes-logically");
  });
});

describe("skill draft executables", () => {
  it("detects available local generation agents in stable menu order", async () => {
    const runner: CommandRunner = {
      async which(command: string): Promise<string | undefined> {
        return command === "claude" || command === "codex"
          ? `/usr/local/bin/${command}`
          : undefined;
      },
      async run(_invocation: CommandInvocation): Promise<CommandResult> {
        throw new Error("not used");
      },
    };

    await expect(detectDraftExecutables(runner)).resolves.toEqual(["claude", "codex"]);
  });

  it("builds inherited agent launch argv with the prompt as the final argument", () => {
    expect(buildDraftInvocation("claude", "draft this")).toEqual({
      command: "claude",
      args: ["--dangerously-skip-permissions", "draft this"],
    });
    expect(buildDraftInvocation("codex", "draft this")).toEqual({
      command: "codex",
      args: ["--yolo", "draft this"],
    });
  });

  it("builds a handoff prompt that tells the launched agent where to write the skill", () => {
    const prompt = buildGenerationHandoffPrompt(
      {
        skillName: "review-pr",
        scope: "project",
        ecosystems: ["claude", "codex"],
        candidate: {
          id: "candidate-1",
          name: "review-pr",
          summary: "review pull requests",
          prompts: [],
          representativePrompts: [
            {
              id: "prompt-1",
              source: "codex",
              sourcePath: "/history.jsonl",
              text: "review this pull request",
            },
          ],
          count: 3,
          coherence: 1,
          rankScore: 10,
          rankReason: "Repeated review workflow.",
          isStrong: true,
        },
      },
      "/repo/.claude/skills/review-pr/SKILL.md",
    );

    expect(prompt).toContain(
      "Create exactly one reusable agent skill and write it directly to this file:",
    );
    expect(prompt).toContain("/repo/.claude/skills/review-pr/SKILL.md");
    expect(prompt).toContain("Do not print the skill instead of writing the file.");
    expect(prompt).not.toContain("Return only the contents of SKILL.md.");
  });
});

describe("agent discovery", () => {
  it("builds a handoff prompt that keeps discovery inside the agent window", () => {
    const prompt = buildAgentDiscoveryHandoffPrompt({
      cwd: "/repo",
      sources: [{ kind: "codex", path: "/home/user/.codex/sessions/session.jsonl" }],
    });

    expect(prompt).toContain("You are running inside the user's selected local agent window.");
    expect(prompt).toContain(
      "The purpose of this tool is to mine stored agent sessions for reusable workflow patterns",
    );
    expect(prompt).toContain(
      "Where this command is run from does not matter for candidate quality",
    );
    expect(prompt).toContain("Read only the listed recorded session/history paths.");
    expect(prompt).toContain(
      "Do not inspect the repository, source tree, shell history, home directory, dotfiles, environment files, or any other host-machine files",
    );
    expect(prompt).toContain("[codex] /home/user/.codex/sessions/session.jsonl");
    expect(prompt).toContain("Existing skill directories to check before proposing candidates:");
    expect(prompt).toContain("[project Claude] /repo/.claude/skills");
    expect(prompt).toContain("[project Codex/agents] /repo/.agents/skills");
    expect(prompt).toContain("[global Claude] ~/.claude/skills");
    expect(prompt).toContain("[global Codex/agents] ~/.agents/skills");
    expect(prompt).toContain("$" + "{XDG_CONFIG_HOME:-~/.config}/agents/skills");
    expect(prompt).toContain(
      "Use existing skill names, descriptions, and instructions to suppress workflows that are already covered.",
    );
    expect(prompt).toContain(
      "If a workflow is only partially covered by an existing skill, keep it only when the missing behavior is substantial",
    );
    expect(prompt).toContain("Do not create any files during discovery.");
    expect(prompt).toContain(
      "Present a human-readable Markdown table directly in this agent window.",
    );
    expect(prompt).toContain(
      "| Skill name | Summary | Reason | Confidence | Scope | Repeats | Representative prompts | Source paths |",
    );
    expect(prompt).toContain("Order rows by your opinionated recommendation");
    expect(prompt).toContain("Ask the user which skill or skills they want to implement.");
    expect(prompt).toContain("Wait for the user's answer before creating or modifying files.");
    expect(prompt).toContain(
      "ask whether the user wants the skill installed project-local to the command path or global under the user's home directory",
    );
    expect(prompt).toContain("/repo/.claude/skills/<name>/SKILL.md");
    expect(prompt).toContain("/repo/.agents/skills/<name>/SKILL.md");
    expect(prompt).toContain("~/.claude/skills/<name>/SKILL.md");
    expect(prompt).toContain("~/.agents/skills/<name>/SKILL.md");
    expect(prompt).toContain("$" + "{XDG_CONFIG_HOME:-~/.config}/agents/skills/<name>/SKILL.md");
    expect(prompt).toContain("Do not assume project-local just because the command was launched");
    expect(prompt).not.toContain("Report path:");
    expect(prompt).not.toContain(".ritual");
  });

  it("launches discovery as an inherited agent session", async () => {
    const invocations: Array<{ invocation: CommandInvocation; cwd: string }> = [];
    const launcher: CommandLauncher = {
      async launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number> {
        invocations.push({ invocation, cwd: options.cwd });
        return 0;
      },
    };

    await expect(
      launchAgentDiscoverySession({
        cwd: "/repo",
        sources: [{ kind: "codex", path: "/history.jsonl" }],
        executable: "claude",
        launcher,
      }),
    ).resolves.toBe(0);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.cwd).toBe("/repo");
    expect(invocations[0]?.invocation.command).toBe("claude");
    expect(invocations[0]?.invocation.args.at(-1)).toContain(
      "Ask the user which skill or skills they want to implement.",
    );
  });
});

describe("skill validation", () => {
  it("accepts a valid SKILL.md with built-in validation when agnix is unavailable", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-valid-"));
    await writeFile(
      path.join(draftDir, "SKILL.md"),
      [
        "---",
        "name: review-pr",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the diff and identify behavior changes.",
        "- Check tests and CI commands before recommending fixes.",
      ].join("\n"),
    );

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem });

    expect(result.errors).toEqual([]);
    expect(result.agnixAvailable).toBe(false);
  });

  it("blocks missing frontmatter and placeholder bodies", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-invalid-"));
    await mkdir(draftDir, { recursive: true });
    await writeFile(path.join(draftDir, "SKILL.md"), "TODO");

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem });

    expect(result.errors.map((error) => error.code)).toContain("invalid-frontmatter");
  });

  it("returns warnings for generic language and missing concrete workflow steps", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-valid-warnings-"));
    await writeFile(
      path.join(draftDir, "SKILL.md"),
      [
        "---",
        "name: review-pr",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "Do the task and be helpful.",
      ].join("\n"),
    );

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("generic-body");
    expect(result.warnings.map((warning) => warning.code)).toContain("missing-workflow-steps");
  });

  it("reports agnix validation failures as structured errors", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-agnix-fail-"));
    await writeFile(
      path.join(draftDir, "SKILL.md"),
      [
        "---",
        "name: review-pr",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the diff and identify behavior changes.",
        "- Check tests and CI commands before recommending fixes.",
      ].join("\n"),
    );
    const runner: CommandRunner = {
      async which(command: string): Promise<string | undefined> {
        return command === "agnix" ? "/usr/local/bin/agnix" : undefined;
      },
      async run(_invocation: CommandInvocation): Promise<CommandResult> {
        throw new Error("agnix command failed");
      },
    };

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem, runner });

    expect(result.errors.map((error) => error.code)).toContain("agnix-validation-failed");
    expect(result.agnixAvailable).toBe(true);
  });
});
