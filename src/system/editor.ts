import { type CommandRunner, nodeCommandRunner } from "./exec.js";

export type EditorResult = {
  opened: boolean;
  message: string;
};

export type RuntimeEnv = NodeJS.ProcessEnv & {
  EDITOR?: string;
};

export async function openEditor(options: {
  filePath: string;
  env: RuntimeEnv;
  runner?: CommandRunner;
}): Promise<EditorResult> {
  const editor = options.env.EDITOR;
  if (editor === undefined || editor.trim().length === 0) {
    return { opened: false, message: "$EDITOR is not set." };
  }

  const parts = editor.trim().split(/\s+/);
  const command = parts[0];
  if (command === undefined) {
    return { opened: false, message: "$EDITOR is empty." };
  }
  const args = [...parts.slice(1), options.filePath];
  const runner = options.runner ?? nodeCommandRunner;
  await runner.run({ command, args });
  return { opened: true, message: `Opened draft in ${editor}.` };
}
