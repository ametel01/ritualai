import type { ExtractedPrompt } from "../history/types.js";
import { clusterPrompts, clusterPromptsAsync } from "./cluster.js";
import type { ClusterOptions, WorkflowCandidate } from "./types.js";
import { DEFAULT_CLUSTER_OPTIONS } from "./types.js";

export function rankWorkflowCandidates(
  prompts: ExtractedPrompt[],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): WorkflowCandidate[] {
  return clusterPrompts(prompts, options);
}

export function rankWorkflowCandidatesAsync(
  prompts: ExtractedPrompt[],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): Promise<WorkflowCandidate[]> {
  return clusterPromptsAsync(prompts, options);
}

export function strongCandidates(candidates: WorkflowCandidate[]): WorkflowCandidate[] {
  return candidates.filter((candidate) => candidate.isStrong);
}

export function nearMissCandidates(candidates: WorkflowCandidate[]): WorkflowCandidate[] {
  return candidates.filter((candidate) => !candidate.isStrong);
}
