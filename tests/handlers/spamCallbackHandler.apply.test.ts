import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn().mockResolvedValue(null),
    decrementWarning: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: { findByChatId: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../src/db/repositories/spamPatternRepository", () => ({
  spamPatternRepository: { markLatestReviewed: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../src/bot/helpers/sendLog", () => ({ sendLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/bot/helpers/unsilenceUser", () => ({ unsilenceUser: vi.fn().mockResolvedValue(true) }));
vi.mock("../../src/bot/helpers/silenceUser", () => ({ silenceUser: vi.fn().mockResolvedValue(true) }));
vi.mock("../../src/bot/helpers/applyWarn", () => ({
  applyWarn: vi.fn().mockResolvedValue({ warnMsgId: 555 }),
}));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));
vi.mock("../../src/utils/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../src/features/promoSpamDetection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/promoSpamDetection")>();
  return { ...actual, notifySpamAdmin: vi.fn().mockResolvedValue(undefined) };
});

import { spamCallbackHandler } from "../../src/bot/handlers/spamCallbackHandler";
import { buildApplyCallbackData } from "../../src/features/promoSpamDetection";
import { notifySpamAdmin } from "../../src/features/promoSpamDetection";
import { userRepository } from "../../src/db/repositories/userRepository";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { silenceUser } from "../../src/bot/helpers/silenceUser";
import { applyWarn } from "../../src/bot/helpers/applyWarn";
import { BotContext } from "../../src/types";

const CHAT_ID = -1001234;
const USER_ID = 99;
const MESSAGE_ID = 42;

function makeCtx(callbackData: string): BotContext {
  return {
    callbackQuery: {
      data: callbackData,
      message: { text: "⚠️ #POSIBLE_SPAM (sin confirmar)\n• A: Alice", entities: [] },
    },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    from: { id: 777, first_name: "Admin", username: "admin" },
    me: { id: 1, first_name: "YukiBot", username: "yukibot" },
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as unknown as BotContext;
}

describe("spamCallbackHandler — apply verdict (manual sanction confirmation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the message, silences + warns the user, and notifies the admin", async () => {
    const data = buildApplyCallbackData(CHAT_ID, USER_ID, MESSAGE_ID);
    const ctx = makeCtx(data);

    await spamCallbackHandler(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, MESSAGE_ID);
    expect(silenceUser).toHaveBeenCalledWith(ctx, USER_ID, CHAT_ID);
    expect(applyWarn).toHaveBeenCalledWith(
      ctx,
      USER_ID,
      CHAT_ID,
      expect.any(String),
      undefined,
      "por spam",
      expect.any(Object)
    );
    expect(notifySpamAdmin).toHaveBeenCalledWith(ctx, null, USER_ID, expect.any(String), undefined);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("hydrates the target's name/username from the user repository when available", async () => {
    (userRepository.findByUserAndChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      name: "Alice",
      username: "alice_tg",
    });
    const data = buildApplyCallbackData(CHAT_ID, USER_ID, MESSAGE_ID);
    const ctx = makeCtx(data);

    await spamCallbackHandler(ctx);

    expect(applyWarn).toHaveBeenCalledWith(
      ctx,
      USER_ID,
      CHAT_ID,
      "Alice",
      "alice_tg",
      "por spam",
      expect.any(Object)
    );
  });

  it("still silences + warns even when the message was already deleted (best-effort)", async () => {
    const data = buildApplyCallbackData(CHAT_ID, USER_ID, MESSAGE_ID);
    const ctx = makeCtx(data);
    (ctx.api.deleteMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("message to delete not found")
    );

    await spamCallbackHandler(ctx);

    expect(silenceUser).toHaveBeenCalledWith(ctx, USER_ID, CHAT_ID);
    expect(applyWarn).toHaveBeenCalled();
  });

  it("does not act on an unrelated/unknown callback payload", async () => {
    const ctx = makeCtx("spam_unknown:1:2");

    await spamCallbackHandler(ctx);

    expect(silenceUser).not.toHaveBeenCalled();
    expect(applyWarn).not.toHaveBeenCalled();
    expect(chatRepository.findByChatId).not.toHaveBeenCalled();
  });
});
