import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotContext } from "../../src/types";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn(),
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
import { resetWelcomeTracker } from "../../src/bot/helpers/welcomeTracker";

const CHAT_ID = -100123;

function makeCtx(userId: number): BotContext {
  const user = { id: userId, is_bot: false, first_name: `U${userId}`, username: `u${userId}` };
  return {
    chatMember: {
      old_chat_member: { status: "left", user },
      new_chat_member: { status: "member", user },
      from: user,
    },
    chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
    me: { id: 999 },
    chatConfig: {
      type: "normal",
      logsTo: null,
      features: { autoBan: false, welcomeMessage: true },
      welcome: { message: "Hola @usuario", button: { enabled: false, text: "", url: "" } },
    },
    api: { banChatMember: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) },
  } as unknown as BotContext;
}

describe("chatMemberHandler — welcome concurrency (one greeting per entry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWelcomeTracker();
    vi.mocked(userRepository.findOrCreate).mockImplementation(
      async (userId: number) => ({ userId, chatId: CHAT_ID, wasBanned: false }) as never
    );
  });

  it("200 distinct users joining at once → 200 welcomes, once each", async () => {
    await Promise.all(
      Array.from({ length: 200 }, (_, i) => chatMemberHandler(makeCtx(i + 1) as never))
    );

    expect(sendWelcome).toHaveBeenCalledTimes(200);
    const greeted = new Set(vi.mocked(sendWelcome).mock.calls.map((c) => (c[3] as { id: number }).id));
    expect(greeted.size).toBe(200);
  });

  it("200 redelivered updates for the SAME user → exactly one welcome", async () => {
    await Promise.all(
      Array.from({ length: 200 }, () => chatMemberHandler(makeCtx(42) as never))
    );

    expect(sendWelcome).toHaveBeenCalledTimes(1);
  });
});
