import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotContext } from "../../src/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: {
    isOwner: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../src/services/chatMigration", () => ({
  migrateChatData: vi.fn(),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/locales/i18n", () => ({
  t: vi.fn((key: string) => key),
}));

import { migrarHandler } from "../../src/bot/commands/migrar";
import { adminRepository } from "../../src/db/repositories/adminRepository";
import { migrateChatData } from "../../src/services/chatMigration";

const DEST = -2002;

function summary(overrides: Record<string, unknown> = {}) {
  return {
    sourceChatId: -1001,
    destChatId: DEST,
    users: 3,
    bannedWords: 2,
    bannedWordsSkipped: 1,
    domainAllowances: 4,
    configCopied: true,
    logsTo: -9009,
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  return {
    chat: { id: DEST, type: "supergroup", title: "New Chat" },
    from: { id: 99, is_bot: false, first_name: "Owner", username: "owner" },
    message: { message_thread_id: undefined },
    match: "-1001",
    chatConfig: { delegatedOwnerId: null },
    reply: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as BotContext;
}

describe("migrarHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRepository.isOwner).mockResolvedValue(true);
    vi.mocked(migrateChatData).mockResolvedValue(summary() as never);
  });

  it("returns early when chat id is missing", async () => {
    const ctx = makeCtx({ chat: undefined });
    await migrarHandler(ctx as never);
    expect(migrateChatData).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("returns early when sender is missing", async () => {
    const ctx = makeCtx({ from: undefined });
    await migrarHandler(ctx as never);
    expect(migrateChatData).not.toHaveBeenCalled();
  });

  it("blocks a non-owner and does not call the service", async () => {
    vi.mocked(adminRepository.isOwner).mockResolvedValue(false);
    const ctx = makeCtx({ chatConfig: { delegatedOwnerId: 12345 } });

    await migrarHandler(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith("migration.notOwner", expect.any(Object));
    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(migrateChatData).not.toHaveBeenCalled();
  });

  it("allows a delegated owner even when adminRepository.isOwner is false", async () => {
    vi.mocked(adminRepository.isOwner).mockResolvedValue(false);
    const ctx = makeCtx({
      from: { id: 555, username: "deleg" },
      chatConfig: { delegatedOwnerId: 555 },
    });

    await migrarHandler(ctx as never);

    expect(migrateChatData).toHaveBeenCalledWith(-1001, DEST, 555);
  });

  it("asks for a source id when no argument is given", async () => {
    const ctx = makeCtx({ match: "" });
    await migrarHandler(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith("migration.specifySource", expect.any(Object));
    expect(migrateChatData).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric source id", async () => {
    const ctx = makeCtx({ match: "not-an-id" });
    await migrarHandler(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith("migration.specifySource", expect.any(Object));
    expect(migrateChatData).not.toHaveBeenCalled();
  });

  it("rejects migrating a chat into itself", async () => {
    const ctx = makeCtx({ match: String(DEST) });
    await migrarHandler(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith("migration.sameChat", expect.any(Object));
    expect(migrateChatData).not.toHaveBeenCalled();
  });

  it("runs the migration, replies success, and posts to logsTo", async () => {
    const ctx = makeCtx();

    await migrarHandler(ctx as never);

    expect(migrateChatData).toHaveBeenCalledWith(-1001, DEST, 99);
    expect(ctx.reply).toHaveBeenCalledWith("migration.success", expect.any(Object));
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(-9009, "migration.logPost");
  });

  it("does not post to logsTo when the source had none", async () => {
    vi.mocked(migrateChatData).mockResolvedValue(summary({ logsTo: null }) as never);
    const ctx = makeCtx();

    await migrarHandler(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith("migration.success", expect.any(Object));
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("maps source_chat_not_found to the localized message", async () => {
    vi.mocked(migrateChatData).mockRejectedValue(new Error("source_chat_not_found"));
    const ctx = makeCtx();

    await migrarHandler(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith("migration.sourceNotFound", expect.any(Object));
  });

  it("maps dest_chat_not_found to the localized message", async () => {
    vi.mocked(migrateChatData).mockRejectedValue(new Error("dest_chat_not_found"));
    const ctx = makeCtx();

    await migrarHandler(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith("migration.destNotSetup", expect.any(Object));
  });

  it("does not throw when posting to logsTo fails (G10)", async () => {
    const ctx = makeCtx({
      api: { sendMessage: vi.fn().mockRejectedValue(new Error("no access")) },
    });

    await expect(migrarHandler(ctx as never)).resolves.toBeUndefined();
    expect(ctx.reply).toHaveBeenCalledWith("migration.success", expect.any(Object));
  });
});
