import { checkbox, confirm, input, select } from "@inquirer/prompts";

export type Choice<Value extends string> = {
  name: string;
  value: Value;
  description?: string;
  checked?: boolean;
};

export type PromptAdapter = {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(message: string, defaultValue?: string): Promise<string>;
  select<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value>;
  checkbox<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value[]>;
};

export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptCancelledError";
  }
}

export const inquirerPromptAdapter: PromptAdapter = {
  async confirm(message: string, defaultValue = false): Promise<boolean> {
    return runPrompt(() => confirm({ message, default: defaultValue }));
  },
  async input(message: string, defaultValue = ""): Promise<string> {
    return runPrompt(() => input({ message, default: defaultValue }));
  },
  async select<Value extends string>(message: string, choices: Choice<Value>[]): Promise<Value> {
    return runPrompt(() => select({ message, choices }));
  },
  async checkbox<Value extends string>(
    message: string,
    choices: Choice<Value>[],
  ): Promise<Value[]> {
    return runPrompt(() => checkbox({ message, choices }));
  },
};

export function isPromptCancelledError(error: unknown): boolean {
  return (
    error instanceof PromptCancelledError ||
    (error instanceof Error && error.name === "ExitPromptError")
  );
}

async function runPrompt<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPromptCancelledError(error)) {
      throw new PromptCancelledError();
    }
    throw error;
  } finally {
    process.stdin.unref?.();
  }
}
