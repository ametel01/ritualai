import type { HistorySource } from "../history/types.js";
import type { CommandLauncher } from "../system/exec.js";
import { buildDraftInvocation, type DraftExecutable } from "./draft.js";

export const AGENT_DISCOVERY_TEMPLATE_VERSION = "ritual-agent-discovery-v1";

export function buildAgentDiscoveryHandoffPrompt(options: {
  cwd: string;
  sources: HistorySource[];
}): string {
  const sourceList = options.sources
    .map((source, index) => `${index + 1}. [${source.kind}] ${source.path}`)
    .join("\n");

  return `Template version: ${AGENT_DISCOVERY_TEMPLATE_VERSION}

You are running inside the user's selected local agent window. Help the user decide which stored prompts are worth turning into reusable skills, then implement the selected skill or skills in this same agent session.

Command working directory, informational only:
${options.cwd}

Recorded session and history paths:
${sourceList}

Existing skill directories to check before proposing candidates:
1. [project Claude] ${options.cwd}/.claude/skills
2. [project Codex/agents] ${options.cwd}/.agents/skills
3. [global Claude] ~/.claude/skills
4. [global Codex/agents] ~/.agents/skills
5. [global Codex/agents XDG] \${XDG_CONFIG_HOME:-~/.config}/agents/skills

Discovery task:
- The purpose of this tool is to mine stored agent sessions for reusable workflow patterns that could become skills.
- Where this command is run from does not matter for candidate quality.
- Read only the listed recorded session/history paths. They may contain JSON or JSONL records.
- Before proposing findings, inspect the listed existing skill directories when they exist.
- Existing skills are the only non-session paths you may inspect during discovery.
- Use existing skill names, descriptions, and instructions to suppress workflows that are already covered.
- If a workflow is only partially covered by an existing skill, keep it only when the missing behavior is substantial, and explain the gap in the Reason cell.
- Do not inspect the repository, source tree, shell history, home directory, dotfiles, environment files, or any other host-machine files during discovery unless they are one of the listed session/history paths or existing skill directories.
- Identify repeated or high-value user workflows that would make useful reusable skills.
- Prefer workflows with clear repeated intent, concrete steps, repo/tool conventions, or recurring review/debug/test/documentation patterns.
- Ignore one-off questions, vague requests, generated output, logs, assistant responses, and private details that should not become reusable instructions.
- Do not create any files during discovery.

Present findings to the user:
- Present a human-readable Markdown table directly in this agent window.
- Use exactly these columns:
  | Skill name | Summary | Reason | Confidence | Scope | Repeats | Representative prompts | Source paths |
- Use one candidate per row.
- Order rows by your opinionated recommendation, strongest candidate first.
- Use lowercase hyphen-case skill names.
- Use confidence values: high, medium, or low.
- Use scope values: project or global.
- Put generalized representative prompts in the Representative prompts cell.
- Put source paths in the Source paths cell.
- After the table, give a short opinionated recommendation for the first skill to implement.
- Ask the user which skill or skills they want to implement. Wait for the user's answer before creating or modifying files.
- If nothing is worth turning into a skill, say that clearly and stop.

Implementation after user approval:
- After the user chooses, create only the selected skill or skills.
- Before writing any skill file, ask whether the user wants the skill installed project-local to the command path or global under the user's home directory.
- Show the concrete current project-local targets before asking: ${options.cwd}/.claude/skills/<name>/SKILL.md and ${options.cwd}/.agents/skills/<name>/SKILL.md.
- Show the global targets before asking: ~/.claude/skills/<name>/SKILL.md and ~/.agents/skills/<name>/SKILL.md, with \${XDG_CONFIG_HOME:-~/.config}/agents/skills/<name>/SKILL.md as the Linux agents location.
- Do not assume project-local just because the command was launched from ${options.cwd}.
- Ask the user any other missing target decisions, including skill name changes and Claude/Codex ecosystem targets.
- Ask before overwriting an existing skill.
- Avoid leaking private history details beyond generalized workflow instructions.
- The final skill file must use YAML frontmatter containing only name and description, followed by concise actionable Markdown instructions.
`;
}

export async function launchAgentDiscoverySession(options: {
  cwd: string;
  sources: HistorySource[];
  executable: DraftExecutable;
  launcher: CommandLauncher;
}): Promise<number> {
  const prompt = buildAgentDiscoveryHandoffPrompt({
    cwd: options.cwd,
    sources: options.sources,
  });
  return options.launcher.launch(buildDraftInvocation(options.executable, prompt), {
    cwd: options.cwd,
  });
}
