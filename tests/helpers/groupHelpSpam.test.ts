import { describe, it, expect } from "vitest";
import {
  parseSpamLog,
  parseTopicIdFromEntities,
} from "../../src/bot/handlers/groupHelpSpamHandler";

describe("parseSpamLog", () => {
  it("returns null for non-SPAM text", () => {
    expect(parseSpamLog("Hello world")).toBeNull();
  });

  it("returns null if #SPAM present but fields are missing", () => {
    expect(parseSpamLog("#SPAM — some random text")).toBeNull();
  });

  it("parses a well-formed spam log", () => {
    const text = [
      "⚠️ #SPAM",
      "• De: John Doe [12345]",
      "• Grupo: My Group [-100999]",
      "• Fecha: 2026-01-01",
    ].join("\n");

    expect(parseSpamLog(text)).toEqual({
      userName: "John Doe",
      userId: 12345,
      chatName: "My Group",
      chatId: -100999,
    });
  });

  it("trims whitespace around names", () => {
    const text = "blah #SPAM\n• De:  Alice   [7]\n• Grupo:  Test Chat  [-1]";
    const result = parseSpamLog(text);
    expect(result?.userName).toBe("Alice");
    expect(result?.chatName).toBe("Test Chat");
  });
});

describe("parseTopicIdFromEntities", () => {
  it("returns undefined for empty array", () => {
    expect(parseTopicIdFromEntities([])).toBeUndefined();
  });

  it("returns undefined when no text_link with thread param", () => {
    expect(
      parseTopicIdFromEntities([
        { type: "bold" },
        { type: "text_link", url: "https://t.me/c/123/456" },
      ])
    ).toBeUndefined();
  });

  it("extracts thread param from text_link entity", () => {
    expect(
      parseTopicIdFromEntities([
        { type: "text_link", url: "https://t.me/c/123/456?thread=789" },
      ])
    ).toBe(789);
  });

  it("handles thread param with & separator", () => {
    expect(
      parseTopicIdFromEntities([
        { type: "text_link", url: "https://t.me/c/123/456?foo=bar&thread=42" },
      ])
    ).toBe(42);
  });
});

