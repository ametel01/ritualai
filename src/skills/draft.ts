import * as path from "node:path";
import type { WorkflowCandidate } from "../prompts/types.js";
import type { CommandInvocation, CommandRunner } from "../system/exec.js";
import type { FileSystem } from "../system/filesystem.js";
import { buildGenerationPrompt } from "./generation-template.js";
import type { SkillEcosystem, SkillScope } from "./paths.js";

export type DraftExecutable = "claude" | "codex";

export type DraftRequest = {
  candidate: WorkflowCandidate;
  skillName: string;
  scope: SkillScope;
  ecosystems: SkillEcosystem[];
};

export async function detectDraftExecutables(runner: CommandRunner): Promise<DraftExecutable[]> {
  const executables: DraftExecutable[] = [];
  for (const executable of DRAFT_EXECUTABLES) {
    if ((await runner.which(executable)) !== undefined) {
      executables.push(executable);
    }
  }
  return executables;
}

export const DRAFT_EXECUTABLES: readonly DraftExecutable[] = ["claude", "codex"];

export function buildDraftInvocation(
  executable: DraftExecutable,
  prompt: string,
): CommandInvocation {
  if (executable === "claude") {
    return { command: "claude", args: ["-p", prompt] };
  }
  return { command: "codex", args: ["exec", prompt] };
}

export async function createSkillDraft(options: {
  request: DraftRequest;
  runner: CommandRunner;
  executable: DraftExecutable;
}): Promise<string> {
  const prompt = buildGenerationPrompt(options.request);
  const result = await options.runner.run(buildDraftInvocation(options.executable, prompt));
  const draft = extractSkillMarkdown(result.stdout);
  if (draft.trim().length === 0) {
    throw new Error("Drafting executable returned an empty SKILL.md.");
  }
  return draft;
}

export async function writeDraftWorkspace(options: {
  cwd: string;
  skillName: string;
  content: string;
  fs: FileSystem;
}): Promise<{ draftDir: string; skillPath: string }> {
  const draftDir = path.join(options.cwd, ".ritual", "drafts", options.skillName);
  const skillPath = path.join(draftDir, "SKILL.md");
  await options.fs.writeTextAtomic(skillPath, options.content);
  return { draftDir, skillPath };
}

export function candidateLooksTooVague(candidate: WorkflowCandidate): boolean {
  const text = candidate.representativePrompts.map((prompt) => prompt.text).join(" ");
  return text.trim().split(/\s+/).length < 12 || candidate.coherence < 0.2;
}

function extractSkillMarkdown(output: string): string {
  const fenced = output.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? output).trim();
}
