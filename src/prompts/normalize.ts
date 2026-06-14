import type { ExtractedPrompt } from "../history/types.js";
import type { NormalizedPrompt } from "./types.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "for",
  "in",
  "it",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "with",
]);

export function normalizePrompt(prompt: ExtractedPrompt): NormalizedPrompt {
  const normalizedText = prompt.text
    .toLowerCase()
    .replace(/[`"'.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalizedText
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  return { prompt, normalizedText, tokens };
}

export function normalizePrompts(prompts: ExtractedPrompt[]): NormalizedPrompt[] {
  return prompts.map((prompt) => normalizePrompt(prompt));
}

export function lexicalSimilarity(left: NormalizedPrompt, right: NormalizedPrompt): number {
  const leftSet = new Set(left.tokens);
  const rightSet = new Set(right.tokens);
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return intersection / union;
}
