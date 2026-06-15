import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { ExpectedUserError, type InspectOutput, type RunInspectInput } from "./types.js";

type PackageJson = {
  readonly name?: string;
  readonly scripts?: ScriptMap;
  readonly dependencies?: DependencyMap;
  readonly devDependencies?: DependencyMap;
  readonly peerDependencies?: DependencyMap;
};

type ScriptMap = Record<string, string | undefined> & {
  readonly doctor?: string;
};

type DependencyMap = Record<string, string | undefined> & {
  readonly expo?: string;
  readonly react?: string;
  readonly "react-native"?: string;
};

export async function runInspect(input: RunInspectInput): Promise<InspectOutput> {
  const rootDirectory = path.resolve(input.directory);
  const packageJsonPath = path.join(rootDirectory, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  if (!hasAnalyzableReactDependency(packageJson)) {
    throw new ExpectedUserError(
      "No analyzable React dependency was found in this project. Run the scan from a React package directory.",
    );
  }

  return {
    diagnostics: [],
    score: 100,
    project: {
      rootDirectory,
      name: packageJson.name ?? path.basename(rootDirectory),
      packageJsonPath,
      hasDoctorScript: packageJson.scripts?.doctor !== undefined,
    },
    didLintFail: false,
    didDeadCodeFail: false,
    baselineDegraded: false,
  };
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJson> {
  try {
    const raw = await readFile(packageJsonPath, "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    throw new ExpectedUserError(
      "No package metadata was found in this project. Run the scan from a package directory.",
    );
  }
}

function hasAnalyzableReactDependency(packageJson: PackageJson): boolean {
  return (
    packageJson.dependencies?.react !== undefined ||
    packageJson.devDependencies?.react !== undefined ||
    packageJson.peerDependencies?.react !== undefined ||
    packageJson.dependencies?.["react-native"] !== undefined ||
    packageJson.dependencies?.expo !== undefined
  );
}
