import * as path from "node:path";
import { type Environment, isCiOrCodingAgentEnvironment } from "../../agents/detect.js";
import { handoffToAgent, shouldOfferInteractiveHandoff } from "../../agents/handoff.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { runInspect as defaultRunInspect } from "../../scan/run-inspect.js";
import { ExpectedUserError, type InspectOutput, type InspectScope } from "../../scan/types.js";
import type { CommandRunner } from "../../system/exec.js";
import { nodeCommandRunner } from "../../system/exec.js";
import type { PromptAdapter } from "../prompts.js";
import { inquirerPromptAdapter } from "../prompts.js";

export type InspectFlags = {
  readonly json?: boolean;
  readonly jsonCompact?: boolean;
  readonly score?: boolean;
  readonly yes?: boolean;
  readonly scope?: InspectScope;
  readonly diff?: boolean;
  readonly blocking?: "error" | "warning" | "none";
  readonly outputDir?: string;
};

export type InspectOutputWriter = {
  stdout(message: string): void;
  stderr(message: string): void;
};

export type InspectActionOptions = {
  readonly cwd?: string;
  readonly env?: Environment | undefined;
  readonly stdinIsTty?: boolean;
  readonly stdoutIsTty?: boolean;
  readonly prompts?: PromptAdapter;
  readonly runner?: CommandRunner;
  readonly output?: InspectOutputWriter;
  readonly setExitCode?: (code: number) => void;
  readonly now?: () => number;
  readonly runInspect?: (input: {
    directory: string;
    scope: InspectScope;
  }) => Promise<InspectOutput>;
};

export type InspectActionResult = {
  readonly output: InspectOutput | null;
  readonly selectedDiagnostics: Diagnostic[];
  readonly exitCode: number;
  readonly elapsedMs: number;
};

export async function inspectAction(
  directory = ".",
  flags: InspectFlags = {},
  options: InspectActionOptions = {},
): Promise<InspectActionResult> {
  const isScoreOnly = Boolean(flags.score);
  const isJsonMode = Boolean(flags.json);
  const isQuiet = isScoreOnly || isJsonMode;
  const requestedDirectory = path.resolve(options.cwd ?? process.cwd(), directory);
  const startTime = options.now?.() ?? performance.now();
  const output = options.output ?? {
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message),
  };
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  try {
    validateModeFlags(flags);
    const scanScope = resolveScope(flags);
    if (!isQuiet) {
      output.stdout("Ritual inspect");
    }

    const inspectOutput = await (options.runInspect ?? defaultRunInspect)({
      directory: requestedDirectory,
      scope: scanScope,
    });
    const selectedDiagnostics = selectDiagnosticsForCli(inspectOutput.diagnostics);
    const exitCode = finalizeScans({
      inspectOutput,
      flags,
      isJsonMode,
      isScoreOnly,
      output,
      setExitCode,
      elapsedMs: (options.now?.() ?? performance.now()) - startTime,
    });

    const skipPrompts = shouldSkipPrompts({
      yes: flags.yes,
      json: flags.json,
      nonInteractive: isCiOrCodingAgentEnvironment(options.env),
      stdinIsTty: options.stdinIsTty ?? process.stdin.isTTY === true,
    });

    if (
      shouldOfferInteractiveHandoff({
        isQuiet,
        skipPrompts,
        stdoutIsTty: options.stdoutIsTty ?? process.stdout.isTTY === true,
        env: options.env,
        selectedDiagnostics,
      })
    ) {
      await handoffToAgent({
        diagnostics: selectedDiagnostics,
        projectName: inspectOutput.project.name,
        rootDirectory: inspectOutput.project.rootDirectory,
        interactive: true,
        outputDirectory: flags.outputDir ?? null,
        prompts: options.prompts ?? inquirerPromptAdapter,
        runner: options.runner ?? nodeCommandRunner,
        output: { write: output.stderr },
      });
    } else if (
      !isQuiet &&
      isCiOrCodingAgentEnvironment(options.env) &&
      selectedDiagnostics.length > 0 &&
      !inspectOutput.project.hasDoctorScript
    ) {
      printCodingAgentInstallHint(output);
    }

    return {
      output: inspectOutput,
      selectedDiagnostics,
      exitCode,
      elapsedMs: (options.now?.() ?? performance.now()) - startTime,
    };
  } catch (error) {
    return handleInspectError(error, isJsonMode, output, setExitCode, startTime, options.now);
  }
}

function validateModeFlags(flags: InspectFlags): void {
  if (flags.json === true && flags.score === true) {
    throw new ExpectedUserError("--json and --score cannot be used together.");
  }
}

function resolveScope(flags: InspectFlags): InspectScope {
  if (flags.scope !== undefined) {
    return flags.scope;
  }
  if (flags.diff === true) {
    return "changed";
  }
  return "full";
}

function shouldSkipPrompts(input: {
  readonly yes?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly nonInteractive: boolean;
  readonly stdinIsTty: boolean;
}): boolean {
  return Boolean(input.yes) || Boolean(input.json) || input.nonInteractive || !input.stdinIsTty;
}

function selectDiagnosticsForCli(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics;
}

function finalizeScans(input: {
  readonly inspectOutput: InspectOutput;
  readonly flags: InspectFlags;
  readonly isJsonMode: boolean;
  readonly isScoreOnly: boolean;
  readonly output: InspectOutputWriter;
  readonly setExitCode: (code: number) => void;
  readonly elapsedMs: number;
}): number {
  if (input.isScoreOnly) {
    input.output.stdout(String(input.inspectOutput.score));
    return 0;
  }

  if (input.isJsonMode) {
    const spacing = input.flags.jsonCompact === true ? 0 : 2;
    input.output.stdout(
      JSON.stringify(
        {
          status: "ok",
          elapsedMs: input.elapsedMs,
          ...input.inspectOutput,
        },
        null,
        spacing,
      ),
    );
  } else {
    input.output.stdout(
      `${input.inspectOutput.diagnostics.length} diagnostic${
        input.inspectOutput.diagnostics.length === 1 ? "" : "s"
      } found. Score: ${input.inspectOutput.score}`,
    );
  }

  if (shouldFailCi(input.inspectOutput, input.flags)) {
    input.setExitCode(1);
    return 1;
  }
  return 0;
}

function shouldFailCi(inspectOutput: InspectOutput, flags: InspectFlags): boolean {
  if (flags.blocking === "none" || inspectOutput.baselineDegraded) {
    return false;
  }
  const blocking = flags.blocking ?? "error";
  return inspectOutput.diagnostics.some((diagnostic) =>
    blocking === "warning" ? true : diagnostic.severity === "error",
  );
}

function printCodingAgentInstallHint(output: InspectOutputWriter): void {
  output.stderr("React Doctor is not installed in this project.");
  output.stderr("Ask the user if they would like to set it up, then run:");
  output.stderr("");
  output.stderr("  npx react-doctor install --yes");
  output.stderr("");
  output.stderr(
    "This adds agent skill files, a `doctor` package script, and react-doctor as a dev dependency.",
  );
}

async function handleInspectError(
  error: unknown,
  isJsonMode: boolean,
  output: InspectOutputWriter,
  setExitCode: (code: number) => void,
  startTime: number,
  now: (() => number) | undefined,
): Promise<InspectActionResult> {
  setExitCode(1);
  const message = error instanceof Error ? error.message : "Unknown error.";
  if (isJsonMode) {
    output.stdout(
      JSON.stringify({
        status: "error",
        elapsedMs: (now?.() ?? performance.now()) - startTime,
        message,
        expected: error instanceof ExpectedUserError,
      }),
    );
  } else {
    output.stderr(message);
  }
  return {
    output: null,
    selectedDiagnostics: [],
    exitCode: 1,
    elapsedMs: (now?.() ?? performance.now()) - startTime,
  };
}
