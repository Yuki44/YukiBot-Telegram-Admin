import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotContext } from "../../src/types";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn(),
    claimWelcome: vi.fn(),
    releaseWelcome: vi.fn().mockResolvedValue(undefined),
    findByUserAndChat: vi.fn(),
    upsert: vi.fn().mockResolvedValue(undefined),
    clearLeftDate: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    syncIdentityAcrossChats: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: {
    remove: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/bot/helpers/sendLog", () => ({
  sendLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/bot/helpers/sendWelcome", () => ({
  sendWelcome: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/bot/helpers/kickTracker", () => ({
  isKickInProgress: vi.fn(() => false),
  clearKick: vi.fn(),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../../src/utils/activityLog", () => ({
  recordActivity: vi.fn(),
}));

import { chatMemberHandler } from "../../src/bot/handlers/chatMemberHandler";
import { userRepository } from "../../src/db/repositories/userRepository";
import { sendWelcome } from "../../src/bot/helpers/sendWelcome";
import { logger } from "../../src/utils/logger";

const CHAT_ID = -100123;

function makeCtx(
  opts: {
    oldStatus?: string;
    status?: string;
    user?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
    features?: Partial<BotContext["chatConfig"] extends infer C ? Record<string, unknown> : never>;
    welcome?: unknown;
    autoBan?: boolean;
    welcomeMessage?: boolean;
  } = {}
): BotContext {
  const user = opts.user ?? { id: 7, is_bot: false, first_name: "Neo", username: "neo" };
  return {
    chatMember: {
      old_chat_member: { status: opts.oldStatus ?? "left", user },
      new_chat_member: { status: opts.status ?? "member", user },
      from: user,
    },
    chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
    me: { id: 999 },
    chatConfig: {
      type: "normal",
      logsTo: null,
      features: { autoBan: opts.autoBan ?? false, welcomeMessage: opts.welcomeMessage ?? true },
      welcome:
        opts.welcome ?? { message: "Hola <@username> a <chat name>", button: { enabled: false, text: "", url: "" } },
    },
    api: {
      banChatMember: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("chatMemberHandler — welcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.findOrCreate).mockResolvedValue({
      userId: 7,
      chatId: CHAT_ID,
      wasBanned: false,
    } as never);
    vi.mocked(userRepository.claimWelcome).mockResolvedValue(true);
    vi.mocked(sendWelcome).mockResolvedValue(true);
  });

  it("does not claim or send when the feature is off", async () => {
    const ctx = makeCtx({ welcomeMessage: false });
    await chatMemberHandler(ctx as never);
    expect(userRepository.claimWelcome).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not claim or send when the message is empty/whitespace", async () => {
    const ctx = makeCtx({ welcome: { message: "   ", button: { enabled: false, text: "", url: "" } } });
    await chatMemberHandler(ctx as never);
    expect(userRepository.claimWelcome).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("sends exactly once with the right args when the claim succeeds", async () => {
    const ctx = makeCtx();
    await chatMemberHandler(ctx as never);

    expect(userRepository.claimWelcome).toHaveBeenCalledWith(7, CHAT_ID);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendWelcome).toHaveBeenCalledWith(
      ctx.api,
      CHAT_ID,
      ctx.chatConfig!.welcome,
      { id: 7, username: "neo", name: "Neo" },
      "Test Group"
    );
    expect(userRepository.releaseWelcome).not.toHaveBeenCalled();
  });

  it("does NOT send when the claim is lost (redelivery / already welcomed)", async () => {
    vi.mocked(userRepository.claimWelcome).mockResolvedValue(false);
    const ctx = makeCtx();
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).not.toHaveBeenCalled();
    expect(userRepository.releaseWelcome).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails so a later join can retry", async () => {
    vi.mocked(sendWelcome).mockResolvedValue(false);
    const ctx = makeCtx();
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(userRepository.releaseWelcome).toHaveBeenCalledWith(7, CHAT_ID);
  });

  it("logs and does not throw when claimWelcome itself throws", async () => {
    vi.mocked(userRepository.claimWelcome).mockRejectedValue(new Error("DB down"));
    const ctx = makeCtx();
    await expect(chatMemberHandler(ctx as never)).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chatMember_welcome", userId: 7, chatId: CHAT_ID })
    );
  });

  it("auto-ban takes precedence: a re-banned user is banned, never welcomed", async () => {
    vi.mocked(userRepository.findOrCreate).mockResolvedValue({
      userId: 7,
      chatId: CHAT_ID,
      wasBanned: true,
    } as never);
    const ctx = makeCtx({ autoBan: true });

    await chatMemberHandler(ctx as never);

    expect(ctx.api!.banChatMember).toHaveBeenCalledWith(CHAT_ID, 7);
    expect(userRepository.claimWelcome).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not welcome on admin promotion", async () => {
    const ctx = makeCtx({ status: "administrator" });
    await chatMemberHandler(ctx as never);
    expect(userRepository.claimWelcome).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not welcome on leave or kick", async () => {
    for (const status of ["left", "kicked"]) {
      vi.clearAllMocks();
      vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
      const ctx = makeCtx({ status, oldStatus: "member" });
      await chatMemberHandler(ctx as never);
      expect(userRepository.claimWelcome).not.toHaveBeenCalled();
      expect(sendWelcome).not.toHaveBeenCalled();
    }
  });

  it("falls back to the first name when the user has no username", async () => {
    const ctx = makeCtx({ user: { id: 7, is_bot: false, first_name: "Trinity" } });
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).toHaveBeenCalledWith(
      ctx.api,
      CHAT_ID,
      expect.anything(),
      { id: 7, username: undefined, name: "Trinity" },
      "Test Group"
    );
  });
});
