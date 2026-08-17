import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/features/bannedWordsEnforcement/cache", () => ({
  getActiveRules: vi.fn(),
}));
vi.mock("../../src/features/bannedWordsEnforcement/matcher", () => ({
  findMatchingRule: vi.fn(),
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
vi.mock("../../src/bot/helpers/contextHelpers", () => ({
  getChatTitle: vi.fn().mockReturnValue("Test Group"),
}));
vi.mock("../../src/utils/activityLog", () => ({
  recordActivity: vi.fn(),
}));
vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: { isChatAdmin: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { bannedWordsEnforcement } from "../../src/features/bannedWordsEnforcement";
import { getActiveRules } from "../../src/features/bannedWordsEnforcement/cache";
import { findMatchingRule } from "../../src/features/bannedWordsEnforcement/matcher";
import { applyWarn } from "../../src/bot/helpers/applyWarn";
import { silenceUser } from "../../src/bot/helpers/silenceUser";
import { sendLog } from "../../src/bot/helpers/sendLog";
import { adminRepository } from "../../src/db/repositories/adminRepository";
import { BotContext, IBannedWord, IChat } from "../../src/types";

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
    features: { bannedWordsEnforcement: true },
    ...overrides,
  } as unknown as IChat;
}

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  const baseMsg = {
    message_id: 42,
    chat: { id: -1001234, type: "supergroup" },
    from: { id: 99, is_bot: false, first_name: "Alice" },
    date: 0,
    text: "bad word here",
  };
  return {
    chatConfig: makeChatConfig(),
    isAdmin: false,
    me: { id: 1, first_name: "YukiBot", username: "yukibot" },
    message: baseMsg,
    chat: baseMsg.chat,
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      banChatMember: vi.fn().mockResolvedValue(true),
      unbanChatMember: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
    deleteMessage: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as BotContext;
}

function makeRule(opts: Partial<IBannedWord> & { actions?: { delete?: boolean; warn?: boolean; silence?: boolean } } = {}): IBannedWord {
  return {
    word: "badword",
    exactMatch: false,
    scope: "all",
    topicId: undefined,
    severity: "aviso",
    ...opts,
  } as unknown as IBannedWord;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("bannedWordsEnforcement — middleware chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminRepository.isChatAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("calls next() when chatConfig is missing", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx({ chatConfig: null }), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when feature flag is off", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(
      makeCtx({ chatConfig: makeChatConfig({ features: { bannedWordsEnforcement: false } as IChat["features"] }) }),
      next
    );
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() for admin author (G4)", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx({ isAdmin: true }), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() when message has no text or caption", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      message: {
        message_id: 42,
        chat: { id: -1001234, type: "supergroup" },
        from: { id: 99, is_bot: false, first_name: "Alice" },
        date: 0,
        sticker: { file_id: "s1" },
      },
    });
    await bannedWordsEnforcement(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when zero rules are configured (the production bug)", async () => {
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
    expect(silenceUser).not.toHaveBeenCalled();
  });

  it("calls next() when rules exist but none match", async () => {
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeRule()]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() when sender is on spamUserWhitelist", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(
      makeCtx({ chatConfig: makeChatConfig({ spamUserWhitelist: [99] }) }),
      next
    );
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("calls next() when DB admin re-check throws then continues (no rules)", async () => {
    (adminRepository.isChatAdmin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when getActiveRules throws (chain must survive DB failure)", async () => {
    (getActiveRules as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("mongo down"));
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(applyWarn).not.toHaveBeenCalled();
  });

  it("does NOT call next() when a rule fires the warn+silence action", async () => {
    const rule = makeRule({ severity: "silenciar" }); // legacy: delete+silence
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).not.toHaveBeenCalled();
    expect(silenceUser).toHaveBeenCalled();
  });

  it("does NOT call next() on the kick action path", async () => {
    const rule = makeRule({ severity: "kick" });
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const next = vi.fn().mockResolvedValue(undefined);
    await bannedWordsEnforcement(makeCtx(), next);
    expect(next).not.toHaveBeenCalled();
  });

  it("dedup: when warn+silence both fire, SILENCIO sendLog payload omits repliedMsg", async () => {
    const rule = makeRule({
      severity: "aviso",
      actions: { delete: true, warn: true, silence: true },
      kick: false,
      flag: false,
    } as Partial<IBannedWord>);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const next = vi.fn().mockResolvedValue(undefined);

    await bannedWordsEnforcement(makeCtx(), next);

    // applyWarn was called with the offending message attached
    const warnCall = (applyWarn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(warnCall).toBeDefined();
    const warnOpts = warnCall[6] as { repliedMsg?: unknown };
    expect(warnOpts.repliedMsg).toBeDefined();

    // sendLog was called for PALABRA_PROHIBIDA and SILENCIO; find the SILENCIO call
    const sendLogCalls = (sendLog as ReturnType<typeof vi.fn>).mock.calls;
    const silencioPayload = sendLogCalls.find((c) => (c[2] as { action?: string })?.action === "SILENCIO")?.[2] as
      | { repliedMsg?: unknown }
      | undefined;
    expect(silencioPayload).toBeDefined();
    expect(silencioPayload!.repliedMsg).toBeUndefined();
  });

  it("flag + warn + silence pings notifyChatId with the combined 'avisado y silenciado'", async () => {
    (applyWarn as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ warnMsgId: 1, warned: true, banned: false });
    const rule = makeRule({
      severity: "aviso",
      actions: { delete: true, warn: true, silence: true },
      kick: false,
      flag: true,
    } as Partial<IBannedWord>);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const ctx = makeCtx({ chatConfig: makeChatConfig({ notifyChatId: -100777 }) });

    await bannedWordsEnforcement(ctx, vi.fn().mockResolvedValue(undefined));

    const notifyCall = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === -100777);
    expect(notifyCall).toBeDefined();
    expect(notifyCall![1]).toContain("avisado y silenciado");
  });

  it("flag-only rule pings notifyChatId with 'no he actuado' and enforces nothing", async () => {
    const rule = makeRule({
      severity: "flag",
      actions: { delete: false, warn: false, silence: false },
      kick: false,
      flag: true,
    } as Partial<IBannedWord>);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const ctx = makeCtx({ chatConfig: makeChatConfig({ notifyChatId: -100777 }) });

    await bannedWordsEnforcement(ctx, vi.fn().mockResolvedValue(undefined));

    const notifyCall = (ctx.api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === -100777);
    expect(notifyCall).toBeDefined();
    expect(notifyCall![1]).toContain("no he actuado");
    expect(applyWarn).not.toHaveBeenCalled();
    expect(silenceUser).not.toHaveBeenCalled();
  });

  it("does NOT ping when flag is set but notifyChatId is unconfigured", async () => {
    const rule = makeRule({
      severity: "flag",
      actions: { delete: false, warn: false, silence: false },
      kick: false,
      flag: true,
    } as Partial<IBannedWord>);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const ctx = makeCtx(); // default config: logsTo set, notifyChatId absent

    await bannedWordsEnforcement(ctx, vi.fn().mockResolvedValue(undefined));

    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("silence-only rule (no warn) STILL forwards original on SILENCIO log", async () => {
    // Behavior matches executeSilence.ts:172-173 — when no warn follows, the silence log carries the forward.
    const rule = makeRule({
      severity: "borrar",
      actions: { delete: true, warn: false, silence: true },
      kick: false,
      flag: false,
    } as Partial<IBannedWord>);
    (getActiveRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([rule]);
    (findMatchingRule as ReturnType<typeof vi.fn>).mockReturnValueOnce(rule);
    const next = vi.fn().mockResolvedValue(undefined);

    await bannedWordsEnforcement(makeCtx(), next);

    expect(applyWarn).not.toHaveBeenCalled();
    const sendLogCalls = (sendLog as ReturnType<typeof vi.fn>).mock.calls;
    const silencioPayload = sendLogCalls.find((c) => (c[2] as { action?: string })?.action === "SILENCIO")?.[2] as
      | { repliedMsg?: unknown }
      | undefined;
    expect(silencioPayload).toBeDefined();
    expect(silencioPayload!.repliedMsg).toBeDefined();
  });
});
