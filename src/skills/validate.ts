import { readdir } from "node:fs/promises";
import * as path from "node:path";
import type { CommandRunner } from "../system/exec.js";
import type { FileSystem } from "../system/filesystem.js";
import { isSafeSkillName } from "./paths.js";

export type ValidationIssue = {
  code: string;
  message: string;
};

export type SkillValidationResult = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  agnixAvailable: boolean;
};

type AgnixResult = {
  available: boolean;
  issue?: ValidationIssue;
};

type Frontmatter = {
  data: Map<string, string>;
  body: string;
};

const PLACEHOLDER_PATTERN = /\b(todo|tbd|placeholder|lorem ipsum|fill this in)\b/i;
const GENERIC_PATTERN = /\b(use this skill|help the user|do the task|be helpful)\b/i;

export async function validateSkillDraft(options: {
  draftDir: string;
  fs: FileSystem;
  runner?: CommandRunner;
  bodyLengthWarning?: number;
}): Promise<SkillValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const skillPath = path.join(options.draftDir, "SKILL.md");
  let content = "";

  try {
    content = await options.fs.readText(skillPath);
  } catch {
    errors.push({ code: "missing-skill", message: "Skill target is missing SKILL.md." });
    return { errors, warnings, agnixAvailable: false };
  }

  const frontmatter = parseFrontmatter(content);
  if (frontmatter === undefined) {
    errors.push({
      code: "invalid-frontmatter",
      message: "SKILL.md must start with YAML frontmatter.",
    });
    return addAgnixIssue({
      agnix: await runAgnix(options.runner, skillPath),
      errors,
      warnings,
    });
  }

  const keys = [...frontmatter.data.keys()];
  for (const key of keys) {
    if (key !== "name" && key !== "description") {
      errors.push({
        code: "unknown-frontmatter-field",
        message: `Unsupported frontmatter field: ${key}.`,
      });
    }
  }

  const name = frontmatter.data.get("name");
  const description = frontmatter.data.get("description");
  if (name === undefined || name.trim().length === 0) {
    errors.push({ code: "missing-name", message: "Frontmatter is missing name." });
  } else if (!isSafeSkillName(name)) {
    errors.push({ code: "invalid-name", message: "Skill name must be lowercase hyphen-case." });
  }

  if (description === undefined || description.trim().length === 0) {
    errors.push({ code: "missing-description", message: "Frontmatter is missing description." });
  } else if (!hasTriggerRichDescription(description)) {
    errors.push({
      code: "weak-description",
      message: "Description must clearly say when the skill should be used.",
    });
  }

  const body = frontmatter.body.trim();
  if (body.length === 0) {
    errors.push({ code: "empty-body", message: "Skill body must not be empty." });
  }
  if (PLACEHOLDER_PATTERN.test(body)) {
    errors.push({ code: "placeholder-body", message: "Skill body contains placeholder text." });
  }
  if (GENERIC_PATTERN.test(body)) {
    warnings.push({ code: "generic-body", message: "Skill body appears generic." });
  }
  if (!/(\n- |\n\d+\. |## )/.test(body)) {
    warnings.push({
      code: "missing-workflow-steps",
      message: "Skill body does not appear to include concrete workflow steps.",
    });
  }
  if (
    /\b(scripts\/|references\/|assets\/)\b/.test(body) &&
    !(await hasBundledResources(options.draftDir))
  ) {
    warnings.push({
      code: "missing-bundled-resources",
      message: "Skill body references bundled resources but no resource directories exist.",
    });
  }
  if (body.length > (options.bodyLengthWarning ?? 5000)) {
    warnings.push({
      code: "long-body",
      message: "Skill body is longer than the configured warning threshold.",
    });
  }

  const agnix = await runAgnix(options.runner, skillPath);
  const withAgnixResult = addAgnixIssue({ agnix, errors, warnings });

  return {
    errors: withAgnixResult.errors,
    warnings: withAgnixResult.warnings,
    agnixAvailable: withAgnixResult.agnixAvailable,
  };
}

function addAgnixIssue(context: {
  agnix: AgnixResult;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}): { errors: ValidationIssue[]; warnings: ValidationIssue[]; agnixAvailable: boolean } {
  if (context.agnix.issue !== undefined) {
    context.errors.push(context.agnix.issue);
  }
  return {
    errors: context.errors,
    warnings: context.warnings,
    agnixAvailable: context.agnix.available,
  };
}

function parseFrontmatter(content: string): Frontmatter | undefined {
  if (!content.startsWith("---\n")) {
    return undefined;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return undefined;
  }
  const raw = content.slice(4, end).trim();
  const body = content.slice(end + 4);
  const data = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match === null) {
      return undefined;
    }
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) {
      return undefined;
    }
    data.set(key, value.replace(/^["']|["']$/g, ""));
  }
  return { data, body };
}

function hasTriggerRichDescription(description: string): boolean {
  return (
    /\b(use|when|trigger|whenever|for|after|before|while)\b/i.test(description) &&
    description.length >= 24
  );
}

async function hasBundledResources(draftDir: string): Promise<boolean> {
  const entries = await readdir(draftDir, { withFileTypes: true }).catch(() => []);
  return entries.some(
    (entry) => entry.isDirectory() && ["scripts", "references", "assets"].includes(entry.name),
  );
}

async function runAgnix(
  runner: CommandRunner | undefined,
  skillPath: string,
): Promise<AgnixResult> {
  if (runner === undefined || (await runner.which("agnix")) === undefined) {
    return { available: false };
  }
  try {
    await runner.run({ command: "agnix", args: ["validate", skillPath] });
    return { available: true };
  } catch {
    return {
      available: true,
      issue: {
        code: "agnix-validation-failed",
        message: "agnix validation failed for generated SKILL.md.",
      },
    };
  }
}
