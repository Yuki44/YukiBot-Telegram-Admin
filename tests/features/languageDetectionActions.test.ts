import { describe, it, expect } from "vitest";
import {
  buildAdminNotifyText,
  buildBotActor,
  buildGraceCallback,
  parseGraceCallback,
  LanguageTarget,
} from "../../src/features/languageDetection/actions";
import { BotContext } from "../../src/types";

const target: LanguageTarget = { userId: 42, name: "Harry", username: "hrushbsbbd" };

describe("buildAdminNotifyText", () => {
  it("builds the warn-tier notify text with the current/max count, chat, and @edjoker mention", () => {
    const text = buildAdminNotifyText(target, 1, false, "GayBCN");
    expect(text).toContain("elav a");
    expect(text).not.toContain("elsilav a");
    expect(text).toContain("por idioma 1/3");
    expect(text).toContain("GayBCN");
    expect(text).toContain("@edjoker");
    expect(text).toContain("https://t.me/hrushbsbbd");
  });

  it("shows the clickable full name followed by the clickable @username in parentheses", () => {
    const text = buildAdminNotifyText(target, 1, false, "GayBCN");
    expect(text).toContain('<a href="https://t.me/hrushbsbbd">Harry</a> (<a href="https://t.me/hrushbsbbd">@hrushbsbbd</a>)');
  });

  it("falls back to a tap-to-copy user ID in parentheses when there is no @username", () => {
    const text = buildAdminNotifyText({ userId: 42, name: "Harry" }, 1, false, "GayBCN");
    expect(text).toContain('<a href="tg://user?id=42">Harry</a> (<code>42</code>)');
  });

  it("omits the chat ID — the chat name is enough", () => {
    const text = buildAdminNotifyText(target, 1, false, "GayBCN");
    expect(text).not.toContain("-1001111111111");
  });

  it("builds the ban-tier notify text on the 3rd warning, including the chat", () => {
    const text = buildAdminNotifyText(target, 3, true, "GayBCN");
    expect(text).toContain("ha sido baneado por 3/3 avisos por idioma");
    expect(text).toContain("GayBCN");
    expect(text).toContain("@edjoker");
  });

  it("has no buttons/call-to-action — plain text only, per spec", () => {
    const text = buildAdminNotifyText(target, 1, false, "GayBCN");
    expect(text).not.toMatch(/<a href="(?!tg:\/\/user|https:\/\/t\.me\/)/);
  });

  it("escapes HTML in the chat name", () => {
    const text = buildAdminNotifyText(target, 1, false, "<b>x</b>");
    expect(text).not.toContain("<b>x</b>");
    expect(text).toContain("&lt;b&gt;");
  });
});

describe("grace callback data", () => {
  it("round-trips chatId/userId", () => {
    const data = buildGraceCallback(-1001234567890, 42);
    expect(parseGraceCallback(data)).toEqual({ chatId: -1001234567890, userId: 42 });
  });

  it("rejects unrelated/malformed data", () => {
    expect(parseGraceCallback("csam_ban:-100:1")).toBeNull();
    expect(parseGraceCallback("langgrace_reset:notanumber:1")).toBeNull();
    expect(parseGraceCallback("")).toBeNull();
  });
});

describe("buildBotActor", () => {
  it("attributes the action to the bot, never to the offending user", () => {
    const ctx = { me: { id: 999, first_name: "YukiBot", username: "yuki_kaylbot" } } as unknown as BotContext;
    expect(buildBotActor(ctx)).toEqual({ id: 999, name: "YukiBot", username: "yuki_kaylbot" });
  });
});
