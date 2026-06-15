import { isPromptCancelledError, PromptCancelledError } from "../../src/cli/prompts.js";

describe("prompt cancellation", () => {
  it("recognizes wrapped and inquirer prompt cancellation errors", () => {
    const inquirerCancel = new Error("User force closed the prompt.");
    inquirerCancel.name = "ExitPromptError";

    expect(isPromptCancelledError(new PromptCancelledError())).toBe(true);
    expect(isPromptCancelledError(inquirerCancel)).toBe(true);
    expect(isPromptCancelledError(new Error("boom"))).toBe(false);
  });
});
