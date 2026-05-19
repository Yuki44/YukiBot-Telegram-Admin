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
import { resetWelcomeTracker } from "../../src/bot/helpers/welcomeTracker";
import { logger } from "../../src/utils/logger";

const CHAT_ID = -100123;

function makeCtx(
  opts: {
    oldStatus?: string;
    status?: string;
    user?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
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
        opts.welcome ?? { message: "Hola @usuario a @nombreGrupo", button: { enabled: false, text: "", url: "" } },
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
    resetWelcomeTracker();
    vi.mocked(userRepository.findOrCreate).mockResolvedValue({
      userId: 7,
      chatId: CHAT_ID,
      wasBanned: false,
    } as never);
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
    vi.mocked(sendWelcome).mockResolvedValue(true);
  });

  it("does not send when the feature is off", async () => {
    const ctx = makeCtx({ welcomeMessage: false });
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not send when the message is empty/whitespace", async () => {
    const ctx = makeCtx({ welcome: { message: "   ", button: { enabled: false, text: "", url: "" } } });
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("sends exactly once with the right args on a join", async () => {
    const ctx = makeCtx();
    await chatMemberHandler(ctx as never);

    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendWelcome).toHaveBeenCalledWith(
      ctx.api,
      CHAT_ID,
      ctx.chatConfig!.welcome,
      { id: 7, username: "neo", name: "Neo" },
      "Test Group"
    );
  });

  it("does NOT send twice for the same entry (chat_member redelivery / overlap)", async () => {
    await chatMemberHandler(makeCtx() as never);
    await chatMemberHandler(makeCtx() as never);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
  });

  it("GREETS AGAIN when the user leaves and re-enters", async () => {
    // First entry → greeted.
    await chatMemberHandler(makeCtx() as never);
    expect(sendWelcome).toHaveBeenCalledTimes(1);

    // Leaves the group (clears the dedup guard).
    await chatMemberHandler(makeCtx({ status: "left", oldStatus: "member" }) as never);

    // Re-enters → greeted a second time.
    await chatMemberHandler(makeCtx({ oldStatus: "left", status: "member" }) as never);
    expect(sendWelcome).toHaveBeenCalledTimes(2);
  });

  it("retries on the next update when the send failed", async () => {
    vi.mocked(sendWelcome).mockResolvedValueOnce(false);
    await chatMemberHandler(makeCtx() as never); // fails → claim released
    await chatMemberHandler(makeCtx() as never); // retried → succeeds
    expect(sendWelcome).toHaveBeenCalledTimes(2);
  });

  it("logs and does not throw when the welcome path throws", async () => {
    vi.mocked(sendWelcome).mockRejectedValueOnce(new Error("boom"));
    const ctx = makeCtx();
    await expect(chatMemberHandler(ctx as never)).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "handleUserJoin_welcome", userId: 7, chatId: CHAT_ID })
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
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not welcome on admin promotion", async () => {
    const ctx = makeCtx({ status: "administrator" });
    await chatMemberHandler(ctx as never);
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does not welcome on leave or kick", async () => {
    for (const status of ["left", "kicked"]) {
      vi.clearAllMocks();
      resetWelcomeTracker();
      vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
      const ctx = makeCtx({ status, oldStatus: "member" });
      await chatMemberHandler(ctx as never);
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
