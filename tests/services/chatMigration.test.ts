import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: {
    findByChatId: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findAllByChatId: vi.fn().mockResolvedValue([]),
    findByUserAndChat: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../src/db/repositories/userDomainAllowanceRepository", () => ({
  userDomainAllowanceRepository: {
    findByChatId: vi.fn().mockResolvedValue([]),
    addDomain: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../src/db/repositories/bannedWordRepository", () => ({
  bannedWordRepository: {
    findByChatAndScope: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { migrateChatData, setChatActive } from "../../src/services/chatMigration";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { userRepository } from "../../src/db/repositories/userRepository";
import { userDomainAllowanceRepository } from "../../src/db/repositories/userDomainAllowanceRepository";
import { bannedWordRepository } from "../../src/db/repositories/bannedWordRepository";

const SRC = -1001;
const DEST = -2002;

function srcChat(overrides: Record<string, unknown> = {}) {
  return {
    chatId: SRC,
    name: "Old",
    type: "normal",
    isActive: true,
    whitelist: true,
    linkWhitelist: ["a.com"],
    spamUserWhitelist: [11],
    logsTo: -9009,
    features: {
      languageDetection: true,
      topicFiltering: false,
      autoBan: true,
      autoWarnSpam: false,
      promoSpamDetection: false,
      bannedWordsEnforcement: true,
      // a stale legacy key that must NOT be carried over:
      spamDetection: true,
    },
    ...overrides,
  };
}

describe("migrateChatData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([]);
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
    vi.mocked(userDomainAllowanceRepository.findByChatId).mockResolvedValue([]);
    vi.mocked(bannedWordRepository.findByChatAndScope).mockResolvedValue([]);
    vi.mocked(chatRepository.upsert).mockResolvedValue({} as never);
  });

  it("throws source_chat_not_found and copies nothing when source is missing", async () => {
    vi.mocked(chatRepository.findByChatId).mockResolvedValueOnce(null as never);

    await expect(migrateChatData(SRC, DEST, 7)).rejects.toThrow("source_chat_not_found");
    expect(chatRepository.upsert).not.toHaveBeenCalled();
    expect(userRepository.upsert).not.toHaveBeenCalled();
  });

  it("throws dest_chat_not_found when destination has not run /setup", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce(null as never);

    await expect(migrateChatData(SRC, DEST, 7)).rejects.toThrow("dest_chat_not_found");
    expect(chatRepository.upsert).not.toHaveBeenCalled();
  });

  it("copies config with canonical feature keys only (drops legacy spamDetection)", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(chatRepository.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(chatRepository.upsert).mock.calls[0][0] as Record<string, unknown>;
    expect(arg.chatId).toBe(DEST);
    expect(arg.whitelist).toBe(true);
    expect(arg.linkWhitelist).toEqual(["a.com"]);
    expect(arg.spamUserWhitelist).toEqual([11]);
    expect(arg.logsTo).toBe(-9009);
    expect(arg.features).toEqual({
      languageDetection: true,
      topicFiltering: false,
      autoBan: true,
      autoWarnSpam: false,
      promoSpamDetection: false,
      bannedWordsEnforcement: true,
    });
    expect(arg.features).not.toHaveProperty("spamDetection");
    // Destination identity/state is never touched.
    expect(arg).not.toHaveProperty("name");
    expect(arg).not.toHaveProperty("type");
    expect(arg).not.toHaveProperty("isActive");
    expect(summary.configCopied).toBe(true);
    expect(summary.logsTo).toBe(-9009);
  });

  it("copies users without silenced status; old chat wins; wasBanned never reverts", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      {
        userId: 1,
        chatId: SRC,
        username: "u1",
        name: "User One",
        warnings: 1,
        warningReasons: ["spam"],
        isMuted: true,
        muteUntil: new Date(),
        isBanned: false,
        wasBanned: false,
      },
    ] as never);
    // Destination already has this user (created by /setup) with stronger state.
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      userId: 1,
      chatId: DEST,
      warnings: 5,
      isBanned: true,
      wasBanned: true,
    } as never);

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(userRepository.upsert).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(userRepository.upsert).mock.calls[0][0];
    // Old chat wins on warnings/isBanned.
    expect(payload.warnings).toBe(1);
    expect(payload.warningReasons).toEqual(["spam"]);
    expect(payload.isBanned).toBe(false);
    // G3: source false but dest true → stays true.
    expect(payload.wasBanned).toBe(true);
    expect(payload.chatId).toBe(DEST);
    // Silenced status is never copied.
    expect(payload).not.toHaveProperty("isMuted");
    expect(payload).not.toHaveProperty("muteUntil");
    expect(summary.users).toBe(1);
  });

  it("carries wasBanned=true forward even when destination user is absent", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      { userId: 2, chatId: SRC, warnings: 0, warningReasons: [], isBanned: false, wasBanned: true },
    ] as never);
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);

    await migrateChatData(SRC, DEST, 7);

    expect(vi.mocked(userRepository.upsert).mock.calls[0][0].wasBanned).toBe(true);
  });

  it("copies per-user domain allowances via addDomain", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);
    vi.mocked(userDomainAllowanceRepository.findByChatId).mockResolvedValue([
      { chatId: SRC, userId: 3, domains: ["x.com", "y.com"] },
    ] as never);

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(userDomainAllowanceRepository.addDomain).toHaveBeenCalledWith(3, DEST, "x.com");
    expect(userDomainAllowanceRepository.addDomain).toHaveBeenCalledWith(3, DEST, "y.com");
    expect(summary.domainAllowances).toBe(1);
  });

  it("copies only scope=all banned words; skips duplicates; continues on error", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);
    vi.mocked(bannedWordRepository.findByChatAndScope).mockResolvedValue([
      { word: "foo", actions: { warn: true }, exactMatch: true, scope: "all" },
      { word: "bar", actions: {}, exactMatch: false, scope: "all" },
    ] as never);
    vi.mocked(bannedWordRepository.create)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("E11000 duplicate key"));

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(bannedWordRepository.findByChatAndScope).toHaveBeenCalledWith(SRC, "all");
    // "topic" scope must never be queried.
    expect(bannedWordRepository.findByChatAndScope).not.toHaveBeenCalledWith(SRC, "topic");
    expect(bannedWordRepository.findByChatAndScope).toHaveBeenCalledTimes(1);
    const firstCreate = vi.mocked(bannedWordRepository.create).mock.calls[0][0];
    expect(firstCreate.chatId).toBe(DEST);
    expect(firstCreate.scope).toBe("all");
    expect(firstCreate.createdBy).toBe(7);
    expect(firstCreate.actions).toEqual({ delete: false, warn: true, silence: false });
    expect(summary.bannedWords).toBe(1);
    expect(summary.bannedWordsSkipped).toBe(1);
  });

  it("returns a complete summary shape", async () => {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat({ logsTo: undefined }) as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(summary).toEqual({
      sourceChatId: SRC,
      destChatId: DEST,
      users: 0,
      bannedWords: 0,
      bannedWordsSkipped: 0,
      domainAllowances: 0,
      configCopied: true,
      logsTo: null,
    });
  });
});

describe("setChatActive", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips isActive via chatRepository.upsert and never deletes", async () => {
    vi.mocked(chatRepository.upsert).mockResolvedValue({ chatId: SRC, isActive: false } as never);

    await setChatActive(SRC, false);

    expect(chatRepository.upsert).toHaveBeenCalledWith({ chatId: SRC, isActive: false });
  });
});
