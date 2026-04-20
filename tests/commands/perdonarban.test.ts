import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotContext, IUser } from "../../src/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn(),
    findByUsername: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../../src/bot/helpers/sendLog", () => ({
  sendLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../../src/locales/i18n", () => ({
  t: vi.fn((key: string) => key),
}));

import { quitarbanHandler } from "../../src/bot/commands/perdonarban";
import { userRepository } from "../../src/db/repositories/userRepository";
import { sendLog } from "../../src/bot/helpers/sendLog";
import { logger } from "../../src/utils/logger";

// ── Helpers ──────────────────────────────────────────────────────────

function makeUser(overrides: Partial<IUser> = {}): IUser {
  return {
    userId: 42,
    chatId: -1001234,
    username: "testuser",
    name: "Test User",
    warnings: 0,
    warningReasons: [],
    isMuted: false,
    isBanned: true,
    wasBanned: true,
    ...overrides,
  } as IUser;
}

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  return {
    chat: { id: -1001234, type: "supergroup", title: "Test Group" },
    message: { message_thread_id: undefined },
    from: { id: 99, is_bot: false, first_name: "Admin", username: "admin" },
    match: "",
    chatConfig: { logsTo: -100999 },
    isAdmin: true,
    reply: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      unbanChatMember: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  } as unknown as BotContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("quitarbanHandler (perdonarban)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Early returns ──────────────────────────────────────────────────

  it("returns early when chat id is missing", async () => {
    const ctx = makeCtx({ chat: undefined });
    await quitarbanHandler(ctx as any);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("replies with warning and deletes message when no match is provided", async () => {
    const ctx = makeCtx({ match: "" });
    await quitarbanHandler(ctx as any);
    expect(ctx.reply).toHaveBeenCalledWith(
      "⚠️ Especifica un usuario.",
      expect.objectContaining({ message_thread_id: undefined }),
    );
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  // ── User lookup by numeric ID ──────────────────────────────────────

  it("looks up user by numeric ID when match is digits-only", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(user);
    const ctx = makeCtx({ match: "42" });
    await quitarbanHandler(ctx as any);
    expect(userRepository.findByUserAndChat).toHaveBeenCalledWith(42, -1001234);
    expect(userRepository.findByUsername).not.toHaveBeenCalled();
  });

  // ── User lookup by @username ───────────────────────────────────────

  it("looks up user by username when match starts with @", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user);
    const ctx = makeCtx({ match: "@testuser" });
    await quitarbanHandler(ctx as any);
    expect(userRepository.findByUsername).toHaveBeenCalledWith("testuser", -1001234);
    expect(userRepository.findByUserAndChat).not.toHaveBeenCalled();
  });

  it("looks up user by username without @ prefix", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user);
    const ctx = makeCtx({ match: "testuser" });
    await quitarbanHandler(ctx as any);
    expect(userRepository.findByUsername).toHaveBeenCalledWith("testuser", -1001234);
  });

  // ── User not found ─────────────────────────────────────────────────

  it("replies with error and deletes message when user is not found", async () => {
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null);
    const ctx = makeCtx({ match: "99999" });
    await quitarbanHandler(ctx as any);
    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Sin registros para este usuario.",
      expect.objectContaining({ message_thread_id: undefined }),
    );
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(userRepository.remove).not.toHaveBeenCalled();
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it("removes user record, unbans, sends log, and confirms in chat", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(user);
    const ctx = makeCtx({ match: "42" });

    await quitarbanHandler(ctx as any);

    // DB record deleted
    expect(userRepository.remove).toHaveBeenCalledWith(42, -1001234);

    // Telegram unban API called
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(-1001234, 42);

    // Log sent
    expect(sendLog).toHaveBeenCalledWith(
      ctx.api,
      ctx.chatConfig,
      expect.objectContaining({
        action: "Q_BAN",
        chatId: -1001234,
      }),
    );

    // Success message without unban-failed suffix
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("@testuser puede volver a unirse."),
      expect.any(Object),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.not.stringContaining("Desbanealo manualmente"),
      expect.any(Object),
    );

    // Original command message deleted
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  // ── Unban failure path ─────────────────────────────────────────────

  it("includes manual-unban hint when api.unbanChatMember throws", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(user);
    const ctx = makeCtx({ match: "42" });
    vi.mocked(ctx.api.unbanChatMember as any).mockRejectedValue(new Error("Telegram error"));

    await quitarbanHandler(ctx as any);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "qban_unban" }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Desbanealo manualmente"),
      expect.any(Object),
    );
  });

  // ── DB error resilience ────────────────────────────────────────────

  it("logs error when user lookup throws and replies not found", async () => {
    vi.mocked(userRepository.findByUserAndChat).mockRejectedValue(new Error("DB down"));
    const ctx = makeCtx({ match: "42" });

    await quitarbanHandler(ctx as any);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "qban_lookup" }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Sin registros para este usuario.",
      expect.any(Object),
    );
  });

  it("logs error when user removal throws but continues", async () => {
    const user = makeUser();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(user);
    vi.mocked(userRepository.remove).mockRejectedValue(new Error("DB error"));
    const ctx = makeCtx({ match: "42" });

    await quitarbanHandler(ctx as any);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "qban_delete" }),
    );
    // Should still attempt unban and reply
    expect(ctx.api.unbanChatMember).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });

  // ── Log payload shape ──────────────────────────────────────────────

  it("sends log with correct target fields from user record", async () => {
    const user = makeUser({ userId: 7, name: "Lucky", username: "lucky7" });
    vi.mocked(userRepository.findByUsername).mockResolvedValue(user);
    const ctx = makeCtx({ match: "@lucky7" });

    await quitarbanHandler(ctx as any);

    expect(sendLog).toHaveBeenCalledWith(
      ctx.api,
      ctx.chatConfig,
      expect.objectContaining({
        action: "Q_BAN",
        target: { id: 7, name: "Lucky", username: "lucky7" },
        chatName: "Test Group",
      }),
    );
  });

  // ── Fallback when user has no username/name ────────────────────────

  it("falls back to userId string when username is undefined", async () => {
    const user = makeUser({ userId: 55, username: undefined, name: undefined });
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(user);
    const ctx = makeCtx({ match: "55" });

    await quitarbanHandler(ctx as any);

    // Reply should use "55" as the identifier
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("@55"),
      expect.any(Object),
    );
  });

  // ── deleteMessage failure is silently ignored ──────────────────────

  it("does not throw when deleteMessage fails", async () => {
    const ctx = makeCtx({ match: "" });
    vi.mocked(ctx.deleteMessage as any).mockRejectedValue(new Error("forbidden"));

    await expect(quitarbanHandler(ctx as any)).resolves.not.toThrow();
  });
});

