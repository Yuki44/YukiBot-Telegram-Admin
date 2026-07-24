import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/features/promoSpamDetection/linkAnalyzer", () => ({
  analyzeLinks: vi.fn().mockReturnValue({ flagged: false, reason: "" }),
}));
vi.mock("../../src/features/promoSpamDetection/patternMatcher", () => ({
  matchesSpamPattern: vi.fn().mockReturnValue({ matched: false, tag: "" }),
}));
vi.mock("../../src/bot/helpers/applyWarn", () => ({
  applyWarn: vi.fn().mockResolvedValue({ warnMsgId: 12345 }),
}));
vi.mock("../../src/bot/helpers/silenceUser", () => ({
  silenceUser: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/bot/helpers/sendLog", () => ({
  sendLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/helpers/forwardToLog", () => ({
  forwardToLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/helpers/contextHelpers", () => ({
  getChatTitle: vi.fn().mockReturnValue("Test Group"),
}));
vi.mock("../../src/db/repositories/spamPatternRepository", () => ({
  spamPatternRepository: { findAll: vi.fn().mockResolvedValue([]) },
  normalizeText: (s: string) => s.toLowerCase().trim(),
}));
vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: { isChatAdmin: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { promoSpamDetection } from "../../src/features/promoSpamDetection";
import { analyzeLinks } from "../../src/features/promoSpamDetection/linkAnalyzer";
import { matchesSpamPattern } from "../../src/features/promoSpamDetection/patternMatcher";
import { applyWarn } from "../../src/bot/helpers/applyWarn";
import { silenceUser } from "../../src/bot/helpers/silenceUser";
import { sendLog } from "../../src/bot/helpers/sendLog";
import { forwardToLog } from "../../src/bot/helpers/forwardToLog";
import { adminRepository } from "../../src/db/repositories/adminRepository";
import { BotContext, IChat } from "../../src/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeChatConfig(overrides: Partial<IChat> = {}): IChat {
  return {
    chatId: -1001234,
    name: "Test Group",
    type: "normal",
    isActive: true,
    whitelist: false,
    logsTo: -100999,
    logFlags: {},
    spamUserWhitelist: [],
    linkWhitelist: [],
    features: { promoSpamDetection: true },
    ...overrides,
  } as unknown as IChat;
}

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  const baseMsg = {
    message_id: 42,
    chat: { id: -1001234, type: "supergroup", username: "testgroup" },
    from: { id: 99, is_bot: false, first_name: "Alice" },
    date: 0,
    text: "check this out: https://example.com/spam",
    entities: [],
    caption_entities: [],
  };
  return {
    chatConfig: makeChatConfig(),
    isAdmin: false,
    me: { id: 1, first_name: "YukiBot", username: "yukibot" },
    message: baseMsg,
    chat: baseMsg.chat,
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  } as unknown as BotContext;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("promoSpamDetection — middleware chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminRepository.isChatAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({ flagged: false, reason: "" });
    (matchesSpamPattern as ReturnType<typeof vi.fn>).mockReturnValue({ matched: false, tag: "" });
  });

  it("calls next() when feature flag is off", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(
      makeCtx({
        chatConfig: makeChatConfig({ features: { promoSpamDetection: false } as IChat["features"] }),
      }),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when logsTo is unset", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(
      makeCtx({ chatConfig: makeChatConfig({ logsTo: undefined as unknown as number }) }),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() for admin author (G4)", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(makeCtx({ isAdmin: true }), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() for whitelisted user", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(makeCtx({ chatConfig: makeChatConfig({ spamUserWhitelist: [99] }) }), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() when neither detector flags the message (clean passthrough)", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
    expect(silenceUser).not.toHaveBeenCalled();
    expect(forwardToLog).not.toHaveBeenCalled();
  });

  it("does NOT call next() when message is flagged (action path terminates)", async () => {
    (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
      flagged: true,
      reason: "enlace_sospechoso",
    });
    const next = vi.fn().mockResolvedValue(undefined);
    await promoSpamDetection(makeCtx(), next);
    expect(next).not.toHaveBeenCalled();
    expect(silenceUser).toHaveBeenCalled();
    expect(applyWarn).toHaveBeenCalled();
  });

  it("forwards 'Mensaje original' exactly once when spam fires (no duplicate from SILENCIO or AVISO)", async () => {
    (matchesSpamPattern as ReturnType<typeof vi.fn>).mockReturnValue({ matched: true, tag: "pattern_x" });
    const next = vi.fn().mockResolvedValue(undefined);

    await promoSpamDetection(makeCtx(), next);

    // forwardToLog called exactly once (the explicit call at line 215)
    expect(forwardToLog).toHaveBeenCalledTimes(1);

    // SILENCIO sendLog payload omits repliedMsg
    const silencioCall = (sendLog as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[2] as { action?: string })?.action === "SILENCIO"
    );
    expect(silencioCall).toBeDefined();
    expect((silencioCall![2] as { repliedMsg?: unknown }).repliedMsg).toBeUndefined();

    // applyWarn options must NOT pass repliedMsg (so its inner sendLog AVISO won't forward again)
    const warnCall = (applyWarn as ReturnType<typeof vi.fn>).mock.calls[0];
    const warnOpts = warnCall[6] as { repliedMsg?: unknown };
    expect(warnOpts.repliedMsg).toBeUndefined();
  });

  it("calls next() when sender is a bot", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx();
    (ctx.message!.from as { is_bot: boolean }).is_bot = true;
    await promoSpamDetection(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  describe("low-confidence link matches (missing-space typos)", () => {
    it("leaves the message/user untouched, logs unconfirmed, and still calls next()", async () => {
      (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
        flagged: true,
        reason: "enlace_sospechoso",
        confidence: "low",
      });
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx();

      await promoSpamDetection(ctx, next);

      expect(next).toHaveBeenCalledOnce();
      expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
      expect(silenceUser).not.toHaveBeenCalled();
      expect(applyWarn).not.toHaveBeenCalled();
      expect(forwardToLog).toHaveBeenCalledTimes(1);

      const sendMessageCall = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sendMessageCall[1]).toContain("sin confirmar");
      const keyboard = (sendMessageCall[2] as { reply_markup: { inline_keyboard: { text: string }[][] } })
        .reply_markup.inline_keyboard;
      expect(keyboard[0][0].text).toContain("Aplicar sanción");
    });

    it("a pattern match stays high-confidence even if the link analyzer reports low", async () => {
      (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
        flagged: true,
        reason: "enlace_sospechoso",
        confidence: "low",
      });
      (matchesSpamPattern as ReturnType<typeof vi.fn>).mockReturnValue({ matched: true, tag: "pattern_x" });
      const next = vi.fn().mockResolvedValue(undefined);

      await promoSpamDetection(makeCtx(), next);

      expect(next).not.toHaveBeenCalled();
      expect(silenceUser).toHaveBeenCalled();
      expect(applyWarn).toHaveBeenCalled();
    });
  });

  describe("notifySpamAdmin (personal admin notification)", () => {
    it("pings notifyChatId when auto-punishing a high-confidence match", async () => {
      (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
        flagged: true,
        reason: "enlace_sospechoso",
        confidence: "high",
      });
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        chatConfig: makeChatConfig({ notifyChatId: -1003617654911, notifyFlags: { notifySpam: true } }),
      });

      await promoSpamDetection(ctx, next);

      expect(ctx.api.sendMessage).toHaveBeenCalledWith(
        -1003617654911,
        expect.stringContaining("He avisado a"),
        expect.objectContaining({ parse_mode: "HTML" })
      );
      // The mention must always be clickable — a tg://user?id= link, not bare text —
      // even when the sender has no public @username (see makeCtx's default sender).
      const msg = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === -1003617654911
      )![1] as string;
      expect(msg).toContain('<a href="tg://user?id=99">');
    });

    it("does not ping when notifySpam is off, even with notifyChatId set", async () => {
      (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
        flagged: true,
        reason: "enlace_sospechoso",
        confidence: "high",
      });
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        chatConfig: makeChatConfig({ notifyChatId: -1003617654911, notifyFlags: { notifySpam: false } }),
      });

      await promoSpamDetection(ctx, next);

      const calls = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c) => c[0] === -1003617654911)).toBe(false);
    });

    it("is not invoked for low-confidence (unconfirmed) matches", async () => {
      (analyzeLinks as ReturnType<typeof vi.fn>).mockReturnValue({
        flagged: true,
        reason: "enlace_sospechoso",
        confidence: "low",
      });
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        chatConfig: makeChatConfig({ notifyChatId: -1003617654911, notifyFlags: { notifySpam: true } }),
      });

      await promoSpamDetection(ctx, next);

      const calls = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c) => c[0] === -1003617654911)).toBe(false);
    });
  });
});
