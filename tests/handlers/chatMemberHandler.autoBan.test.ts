import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotContext } from "../../src/types";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn(),
    claimWelcome: vi.fn().mockResolvedValue(true),
    releaseWelcome: vi.fn().mockResolvedValue(undefined),
    findByUserAndChat: vi.fn(),
    upsert: vi.fn().mockResolvedValue(undefined),
    clearLeftDate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    syncIdentityAcrossChats: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: { remove: vi.fn().mockResolvedValue(undefined), upsert: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../src/bot/helpers/sendLog", () => ({ sendLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/bot/helpers/sendWelcome", () => ({ sendWelcome: vi.fn().mockResolvedValue(true) }));
vi.mock("../../src/bot/helpers/kickTracker", () => ({
  isKickInProgress: vi.fn(() => false),
  clearKick: vi.fn(),
}));
vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));

import { chatMemberHandler } from "../../src/bot/handlers/chatMemberHandler";
import { userRepository } from "../../src/db/repositories/userRepository";
import { sendWelcome } from "../../src/bot/helpers/sendWelcome";
import { recordActivity } from "../../src/utils/activityLog";
import { logger } from "../../src/utils/logger";

const CHAT_ID = -100123;

function makeCtx(
  userId: number,
  api: { banChatMember: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> },
  autoBan = true
): BotContext {
  const user = { id: userId, is_bot: false, first_name: `U${userId}`, username: `u${userId}` };
  return {
    chatMember: {
      old_chat_member: { status: "kicked", user },
      new_chat_member: { status: "member", user },
      from: { id: 999, is_bot: false, first_name: "Admin" },
    },
    chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
    me: { id: 999 },
    chatConfig: {
      type: "normal",
      logsTo: null,
      // welcomeMessage off → the welcome path is irrelevant to these tests.
      features: { autoBan, welcomeMessage: false },
      welcome: { message: "", button: { enabled: false, text: "", url: "" } },
    },
    api,
  } as unknown as BotContext;
}

function freshApi() {
  return {
    banChatMember: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("chatMemberHandler — auto-ban under pressure", () => {
  beforeEach(() => vi.clearAllMocks());

  function bannedSet(ids: Set<number>) {
    vi.mocked(userRepository.findOrCreate).mockImplementation(
      async (userId: number) =>
        ({ userId, chatId: CHAT_ID, wasBanned: ids.has(userId) }) as never
    );
  }

  it("bans a single re-entering banned user exactly once and records the activity", async () => {
    bannedSet(new Set([7]));
    const api = freshApi();

    await chatMemberHandler(makeCtx(7, api) as never);

    expect(api.banChatMember).toHaveBeenCalledTimes(1);
    expect(api.banChatMember).toHaveBeenCalledWith(CHAT_ID, 7);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "autoban", chatId: CHAT_ID })
    );
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not ban when the autoBan feature is off, even if wasBanned", async () => {
    bannedSet(new Set([7]));
    const api = freshApi();

    await chatMemberHandler(makeCtx(7, api, false) as never);

    expect(api.banChatMember).not.toHaveBeenCalled();
  });

  it("mixed banned + clean joining concurrently → bans exactly the banned set, misses none", async () => {
    const banned = new Set([2, 5, 8, 13, 21]);
    bannedSet(banned);
    const api = freshApi();

    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    await Promise.all(ids.map((id) => chatMemberHandler(makeCtx(id, api) as never)));

    const bannedCalls = api.banChatMember.mock.calls.map((c) => c[1] as number).sort((a, b) => a - b);
    expect(bannedCalls).toEqual([...banned].sort((a, b) => a - b));
  });

  it("200 banned users joining at once → banChatMember called exactly 200 times, no miss", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => i + 1);
    bannedSet(new Set(ids));
    const api = freshApi();

    await Promise.all(ids.map((id) => chatMemberHandler(makeCtx(id, api) as never)));

    expect(api.banChatMember).toHaveBeenCalledTimes(200);
    const unique = new Set(api.banChatMember.mock.calls.map((c) => c[1] as number));
    expect(unique.size).toBe(200);
  });

  it("logs (does not throw) when banChatMember rejects for some users under load", async () => {
    const ids = [1, 2, 3, 4];
    bannedSet(new Set(ids));
    const api = freshApi();
    // Simulate Telegram flood-control rejecting half the burst at the handler's
    // direct call site (the transport-level @grammyjs/auto-retry that absorbs
    // these in production is verified separately in autoRetry.test.ts).
    api.banChatMember.mockImplementation(async (_chatId: number, userId: number) => {
      if (userId % 2 === 0) throw new Error("429: Too Many Requests");
      return true;
    });

    await Promise.all(ids.map((id) => chatMemberHandler(makeCtx(id, api) as never)));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chatMember_autoReban", chatId: CHAT_ID })
    );
    // Every banned user was still attempted — the logic itself never skips one.
    expect(api.banChatMember).toHaveBeenCalledTimes(4);
  });
});
