import { describe, it, expect } from "vitest";
import { buildUserPrompt } from "../../src/features/languageDetection/classifier";

describe("buildUserPrompt", () => {
  it("wraps the message text for the classification prompt", () => {
    expect(buildUserPrompt("How old are you")).toBe('Message:\n"""\nHow old are you\n"""');
  });

  it("passes explicit/vulgar text through unchanged — this is a pure wrapper, not a filter", () => {
    const text = "some vulgar message content";
    expect(buildUserPrompt(text)).toContain(text);
  });
});
