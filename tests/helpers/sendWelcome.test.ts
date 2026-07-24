import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { renderWelcome, sendWelcome } from "../../src/bot/helpers/sendWelcome";
import { logger } from "../../src/utils/logger";

const WELCOME = (over: Partial<{ message: string; enabled: boolean; text: string; url: string }> = {}) => ({
  message: over.message ?? "Hola",
  button: {
    enabled: over.enabled ?? false,
    text: over.text ?? "",
    url: over.url ?? "",
  },
});

describe("renderWelcome", () => {
  it("wraps @username in a tg://user?id= link so it's always clickable", () => {
    const out = renderWelcome("Hola <@username>", { id: 1, username: "neo", name: "Neo" }, "Grupo");
    expect(out).toBe('Hola <a href="tg://user?id=1">@neo</a>');
  });

  it("falls back to the escaped name, still wrapped in a clickable link, when there is no username", () => {
    const out = renderWelcome("Hola <@username>", { id: 1, name: "A<b>&c" }, "Grupo");
    expect(out).toBe('Hola <a href="tg://user?id=1">A&lt;b&gt;&amp;c</a>');
  });

  it("substitutes <chat name> with the escaped chat title", () => {
    const out = renderWelcome("Bienvenido a <chat name>", { id: 1, name: "N" }, "Café <3 & Té");
    expect(out).toBe("Bienvenido a Café &lt;3 &amp; Té");
  });

  it("replaces every occurrence of both tokens, order-independent", () => {
    const out = renderWelcome(
      "<chat name>: hola <@username>, <@username> en <chat name>",
      { id: 1, username: "x", name: "X" },
      "G"
    );
    const link = '<a href="tg://user?id=1">@x</a>';
    expect(out).toBe(`G: hola ${link}, ${link} en G`);
  });

  it("escapes admin-entered HTML while keeping generated tokens live", () => {
    const out = renderWelcome(
      "<b>hola</b> <@username> & bienvenido",
      { id: 1, username: "neo", name: "Neo" },
      "G"
    );
    expect(out).toBe('&lt;b&gt;hola&lt;/b&gt; <a href="tg://user?id=1">@neo</a> &amp; bienvenido');
  });

  it("supports the current @usuario / @nombreGrupo tokens", () => {
    const out = renderWelcome(
      "Bienvenido @usuario a @nombreGrupo",
      { id: 1, username: "neo", name: "Neo" },
      "Café <3 & Té"
    );
    expect(out).toBe('Bienvenido <a href="tg://user?id=1">@neo</a> a Café &lt;3 &amp; Té');
  });

  it("still supports the legacy <@username> / <chat name> tokens (back-compat)", () => {
    const out = renderWelcome(
      "Bienvenido <@username> a <chat name>",
      { id: 1, username: "neo", name: "Neo" },
      "Grupo"
    );
    expect(out).toBe('Bienvenido <a href="tg://user?id=1">@neo</a> a Grupo');
  });

  it("mixes new and legacy tokens, and falls back to a clickable name-link with no username", () => {
    const out = renderWelcome(
      "@usuario / <@username> en @nombreGrupo / <chat name>",
      { id: 1, name: "Trinity" },
      "G"
    );
    const link = '<a href="tg://user?id=1">Trinity</a>';
    expect(out).toBe(`${link} / ${link} en G / G`);
  });

  it("does NOT expand a longer word that merely starts with @usuario", () => {
    const out = renderWelcome("lista de @usuarios aquí", { id: 1, username: "neo", name: "Neo" }, "G");
    expect(out).toBe("lista de @usuarios aquí");
  });
});

describe("sendWelcome", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeApi() {
    return { sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }) };
  }

  it("sends one HTML message with an inline URL button when the button is valid", async () => {
    const api = makeApi();
    const ok = await sendWelcome(
      api as never,
      -100,
      WELCOME({ message: "Hola <@username>", enabled: true, text: "Únete", url: "https://t.me/c" }),
      { id: 7, username: "neo", name: "Neo" },
      "Grupo"
    );

    expect(ok).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, other] = api.sendMessage.mock.calls[0];
    expect(chatId).toBe(-100);
    expect(text).toBe('Hola <a href="tg://user?id=7">@neo</a>');
    expect(other.parse_mode).toBe("HTML");
    expect(other.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Únete", url: "https://t.me/c" }]],
    });
  });

  it("omits the keyboard when the button is disabled", async () => {
    const api = makeApi();
    await sendWelcome(api as never, -100, WELCOME({ enabled: false }), { id: 7, name: "N" }, "G");
    expect(api.sendMessage.mock.calls[0][2].reply_markup).toBeUndefined();
  });

  it("omits the keyboard when the button is enabled but text/url are blank", async () => {
    const api = makeApi();
    await sendWelcome(
      api as never,
      -100,
      WELCOME({ enabled: true, text: "  ", url: "" }),
      { id: 7, name: "N" },
      "G"
    );
    expect(api.sendMessage.mock.calls[0][2].reply_markup).toBeUndefined();
  });

  it("returns false and logs (never throws) when sendMessage fails", async () => {
    const api = { sendMessage: vi.fn().mockRejectedValue(new Error("429")) };
    const ok = await sendWelcome(api as never, -100, WELCOME(), { id: 7, name: "N" }, "G");
    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sendWelcome", chatId: -100, userId: 7 })
    );
  });
});
