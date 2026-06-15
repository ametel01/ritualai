import { fileURLToPath } from "node:url";
import { runInteractiveSession, type SessionResult } from "./interactive.js";
import { isPromptCancelledError } from "./prompts.js";

export type CliOutput = {
  stdout(message: string): void;
  stderr(message: string): void;
};

export type RuntimeStdin = {
  on(event: "error", listener: (error: unknown) => void): RuntimeStdin;
  unref?: () => void;
};

export type RunCliOptions = {
  readonly argv?: string[];
  readonly stdin?: RuntimeStdin | undefined;
  readonly output?: CliOutput;
  readonly setExitCode?: (code: number) => void;
  readonly runInteractive?: () => Promise<SessionResult>;
};

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  installGracefulExitHandlers();
  unrefStdin(options.stdin ?? process.stdin);
  guardStdin(options.stdin ?? process.stdin);

  const argv = options.argv ?? process.argv;
  const args = normalizeHelpInvocation(argv.slice(2));
  const output = options.output ?? {
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message),
  };
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  if (args.length > 0) {
    output.stderr("Ritual has one interactive command and no subcommands or flags.");
    setExitCode(1);
    return;
  }

  try {
    const result = await (options.runInteractive ?? runInteractiveSession)();
    if (result.status === "cancelled") {
      output.stdout(`Ritual stopped: ${result.reason}`);
    }
  } catch (error) {
    handleTopLevelError(error, output, setExitCode);
  }
}

export function normalizeHelpInvocation(args: readonly string[]): string[] {
  return args.map((arg) => (arg === "help" ? "--help" : arg));
}

export function isDirectEntrypoint(importMetaUrl: string, argv = process.argv): boolean {
  const entrypoint = argv[1];
  return entrypoint !== undefined && fileURLToPath(importMetaUrl) === entrypoint;
}

function installGracefulExitHandlers(): void {
  process.once("SIGINT", () => {
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    process.exitCode = 143;
  });
}

function unrefStdin(stdin: RuntimeStdin): void {
  stdin.unref?.();
}

function guardStdin(stdin: RuntimeStdin): void {
  stdin.on("error", (error) => {
    if (isNodeError(error) && error.code === "EIO") {
      return;
    }
    throw error;
  });
}

function handleTopLevelError(
  error: unknown,
  output: CliOutput,
  setExitCode: (code: number) => void,
): void {
  const message = error instanceof Error ? error.message : "Unknown error.";
  if (isPromptCancelledError(error)) {
    output.stdout("Ritual stopped: Cancelled.");
    return;
  }
  output.stderr(`Ritual failed: ${message}`);
  setExitCode(1);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
