import type { Diagnostic } from "../diagnostics/types.js";

export type InspectScope = "full" | "files" | "changed" | "lines";

export type ProjectInfo = {
  readonly rootDirectory: string;
  readonly name: string;
  readonly packageJsonPath?: string;
  readonly hasDoctorScript: boolean;
};

export type InspectOutput = {
  readonly diagnostics: Diagnostic[];
  readonly score: number;
  readonly project: ProjectInfo;
  readonly didLintFail: boolean;
  readonly lintFailureReason?: string;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason?: string;
  readonly baselineDegraded: boolean;
};

export type RunInspectInput = {
  readonly directory: string;
  readonly scope: InspectScope;
};

export class ExpectedUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedUserError";
  }
}
