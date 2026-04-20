import { describe, it, expect } from "vitest";
import { parseArgs, buildActor, getChatTitle } from "../../src/bot/helpers/contextHelpers";
import { BotContext } from "../../src/types";

// Minimal BotContext stubs
function makeCtx(overrides: Partial<BotContext> = {}): BotContext {
  return overrides as BotContext;
}

describe("parseArgs", () => {
  it("returns empty array when match is undefined", () => {
    expect(parseArgs(makeCtx({ match: undefined }))).toEqual([]);
  });

  it("splits space-separated match string", () => {
    expect(parseArgs(makeCtx({ match: "@user reason here" } as Partial<BotContext>))).toEqual([
      "@user",
      "reason",
      "here",
    ]);
  });

  it("trims and filters empty tokens", () => {
    expect(parseArgs(makeCtx({ match: "  @user   reason  " } as Partial<BotContext>))).toEqual([
      "@user",
      "reason",
    ]);
  });
});

describe("buildActor", () => {
  it("returns undefined when from is absent", () => {
    expect(buildActor(makeCtx({ from: undefined }))).toBeUndefined();
  });

  it("builds LogUser from ctx.from with last name", () => {
    const actor = buildActor(
      makeCtx({
        from: { id: 1, is_bot: false, first_name: "John", last_name: "Doe", username: "jdoe" },
      } as Partial<BotContext>)
    );
    expect(actor).toEqual({ id: 1, name: "John Doe", username: "jdoe" });
  });

  it("builds LogUser without last name", () => {
    const actor = buildActor(
      makeCtx({
        from: { id: 2, is_bot: false, first_name: "Alice" },
      } as Partial<BotContext>)
    );
    expect(actor).toEqual({ id: 2, name: "Alice", username: undefined });
  });
});

describe("getChatTitle", () => {
  it("returns 'Unknown' when chat is undefined", () => {
    expect(getChatTitle(makeCtx({ chat: undefined }))).toBe("Unknown");
  });

  it("returns title from a group chat", () => {
    expect(
      getChatTitle(
        makeCtx({
          chat: { id: -100123, type: "supergroup", title: "My Group" },
        } as Partial<BotContext>)
      )
    ).toBe("My Group");
  });

  it("returns 'Unknown' for private chat without title", () => {
    expect(
      getChatTitle(
        makeCtx({
          chat: { id: 123, type: "private", first_name: "Bob" },
        } as Partial<BotContext>)
      )
    ).toBe("Unknown");
  });
});

