import { fileURLToPath } from "node:url";
import { runInteractiveSession, type SessionResult } from "./interactive.js";

export type CliOutput = {
  stdout(message: string): void;
  stderr(message: string): void;
};

export type RunCliOptions = {
  readonly runInteractive?: () => Promise<SessionResult>;
  readonly output?: CliOutput;
  readonly setExitCode?: (code: number) => void;
  readonly stdin?: NodeJS.ReadStream | undefined;
  readonly argv?: string[];
};

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  installSignalHandlers();
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
    output.stderr("Ritual MVP has one interactive command and no subcommands or flags.");
    setExitCode(args.includes("--help") ? 0 : 1);
    return;
  }

  try {
    const result = await (options.runInteractive ?? runInteractiveSession)();
    if (result.status === "cancelled") {
      output.stdout(`Ritual stopped: ${result.reason}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    output.stderr(`Ritual failed: ${message}`);
    setExitCode(1);
  }
}

export function normalizeHelpInvocation(args: string[]): string[] {
  return args.map((arg) => (arg === "help" ? "--help" : arg));
}

export function isDirectEntrypoint(importMetaUrl: string, argv = process.argv): boolean {
  const entry = argv[1];
  return entry !== undefined && fileURLToPath(importMetaUrl) === entry;
}

function installSignalHandlers(): void {
  process.once("SIGINT", () => {
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    process.exitCode = 143;
  });
}

function unrefStdin(stdin: NodeJS.ReadStream): void {
  stdin.unref?.();
}

function guardStdin(stdin: NodeJS.ReadStream): void {
  stdin.on("error", (error) => {
    if (error instanceof Error && "code" in error && error.code === "EIO") {
      return;
    }
    throw error;
  });
}
