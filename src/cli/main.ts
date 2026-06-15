#!/usr/bin/env node
import { isDirectEntrypoint, runCli } from "./runtime.js";

if (isDirectEntrypoint(import.meta.url)) {
  await runCli();
}

export { runCli } from "./runtime.js";
