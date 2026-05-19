import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotContext } from "../../src/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: {
    ensureInitialized: vi.fn().mockResolvedValue({ chatId: -100 }),
  },
}));

vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: {
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/bot/helpers/profilePhoto", () => ({
  discoverProfilePhoto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/locales/i18n", () => ({
  t: vi.fn((key: string) => key),
}));

import { setupHandler } from "../../src/bot/commands/setup";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { adminRepository } from "../../src/db/repositories/adminRepository";
import { userRepository } from "../../src/db/repositories/userRepository";
import { logger } from "../../src/utils/logger";

// ── Helpers ──────────────────────────────────────────────────────────

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  return {
    chat: { id: -100, type: "supergroup", title: "Test Group" },
    from: { id: 99, is_bot: false, first_name: "Owner", username: "owner" },
    message: { message_thread_id: undefined },
    getChatMember: vi.fn().mockResolvedValue({ status: "creator" }),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {
      getChat: vi.fn().mockResolvedValue({ title: "Test Group" }),
      getChatAdministrators: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as BotContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("setupHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chatRepository.ensureInitialized).mockResolvedValue({ chatId: -100 } as never);
  });

  it("returns early when chat id is missing", async () => {
    const ctx = makeCtx({ chat: undefined });
    await setupHandler(ctx as never);
    expect(chatRepository.ensureInitialized).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("returns early when sender is missing", async () => {
    const ctx = makeCtx({ from: undefined });
    await setupHandler(ctx as never);
    expect(chatRepository.ensureInitialized).not.toHaveBeenCalled();
  });

  it("does nothing when the sender is not the chat creator", async () => {
    const ctx = makeCtx({
      getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }),
    });
    await setupHandler(ctx as never);
    expect(chatRepository.ensureInitialized).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("initializes a normal group and replies with the localized success string", async () => {
    const ctx = makeCtx({
      api: {
        getChat: vi.fn().mockResolvedValue({ title: "My Group" }),
        getChatAdministrators: vi.fn().mockResolvedValue([]),
      },
    });

    await setupHandler(ctx as never);

    expect(chatRepository.ensureInitialized).toHaveBeenCalledWith(-100, {
      name: "My Group",
      type: "normal",
    });
    expect(ctx.reply).toHaveBeenCalledWith("setup.initialized", expect.any(Object));
  });

  it("detects a forum chat as type=topics and replies with the topics string", async () => {
    const ctx = makeCtx({
      api: {
        getChat: vi.fn().mockResolvedValue({ title: "Forum", is_forum: true }),
        getChatAdministrators: vi.fn().mockResolvedValue([]),
      },
    });

    await setupHandler(ctx as never);

    expect(chatRepository.ensureInitialized).toHaveBeenCalledWith(-100, {
      name: "Forum",
      type: "topics",
    });
    expect(ctx.reply).toHaveBeenCalledWith("setup.initializedTopics", expect.any(Object));
  });

  it("syncs real admins but filters bots and the anonymous-admin bot", async () => {
    const ctx = makeCtx({
      api: {
        getChat: vi.fn().mockResolvedValue({ title: "G" }),
        getChatAdministrators: vi.fn().mockResolvedValue([
          { status: "creator", user: { id: 1, is_bot: false, first_name: "Real" } },
          { status: "administrator", user: { id: 2, is_bot: true, first_name: "Bot" } },
          { status: "administrator", user: { id: 1087968824, is_bot: false, first_name: "Anon" } },
        ]),
      },
    });

    await setupHandler(ctx as never);

    expect(adminRepository.upsert).toHaveBeenCalledTimes(1);
    expect(adminRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, role: "owner" })
    );
    expect(userRepository.findOrCreate).toHaveBeenCalledWith(1, -100, undefined, "Real");
  });

  it("logs the error and replies with the localized failure string when init throws", async () => {
    vi.mocked(chatRepository.ensureInitialized).mockRejectedValue(new Error("DB down"));
    const ctx = makeCtx();

    await setupHandler(ctx as never);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "setup", error: expect.stringContaining("DB down") })
    );
    expect(ctx.reply).toHaveBeenCalledWith("setup.failed", expect.any(Object));
  });
});
