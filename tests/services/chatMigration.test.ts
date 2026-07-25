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
      usersMerged: 0,
      usersSkipped: 0,
      bannedWords: 0,
      bannedWordsSkipped: 0,
      domainAllowances: 0,
      configCopied: true,
      logsTo: null,
    });
  });
});

// ── Selective migration (web flow) ───────────────────────────────────
describe("migrateChatData — selective options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([]);
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
    vi.mocked(userDomainAllowanceRepository.findByChatId).mockResolvedValue([]);
    vi.mocked(bannedWordRepository.findByChatAndScope).mockResolvedValue([]);
    vi.mocked(chatRepository.upsert).mockResolvedValue({} as never);
  });

  function mockChats() {
    vi.mocked(chatRepository.findByChatId)
      .mockResolvedValueOnce(srcChat() as never)
      .mockResolvedValueOnce({ chatId: DEST } as never);
  }

  it("skips chat config when chatConfig=false", async () => {
    mockChats();
    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: true,
      domainAllowances: true,
    });
    expect(chatRepository.upsert).not.toHaveBeenCalled();
    expect(summary.configCopied).toBe(false);
  });

  it("skips banned words when bannedWords=false", async () => {
    mockChats();
    vi.mocked(bannedWordRepository.findByChatAndScope).mockResolvedValue([
      { word: "foo", actions: {}, exactMatch: true, scope: "all" },
    ] as never);
    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: true,
      users: true,
      bannedWords: false,
      domainAllowances: true,
    });
    expect(bannedWordRepository.findByChatAndScope).not.toHaveBeenCalled();
    expect(bannedWordRepository.create).not.toHaveBeenCalled();
    expect(summary.bannedWords).toBe(0);
  });

  it("skips domain allowances when domainAllowances=false", async () => {
    mockChats();
    vi.mocked(userDomainAllowanceRepository.findByChatId).mockResolvedValue([
      { chatId: SRC, userId: 9, domains: ["a.com"] },
    ] as never);
    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: true,
      users: true,
      bannedWords: true,
      domainAllowances: false,
    });
    expect(userDomainAllowanceRepository.findByChatId).not.toHaveBeenCalled();
    expect(userDomainAllowanceRepository.addDomain).not.toHaveBeenCalled();
    expect(summary.domainAllowances).toBe(0);
  });

  it("skips users entirely when users=false", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      { userId: 1, chatId: SRC, warnings: 0, warningReasons: [], isBanned: true, wasBanned: true },
    ] as never);
    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: true,
      users: false,
      bannedWords: true,
      domainAllowances: true,
    });
    expect(userRepository.findAllByChatId).not.toHaveBeenCalled();
    expect(userRepository.upsert).not.toHaveBeenCalled();
    expect(summary.users).toBe(0);
    expect(summary.usersSkipped).toBe(0);
  });

  it("bansOnly: copies only banned users, clears warnings/reasons, sets wasBanned", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      // Warned-but-not-banned → must be dropped in bansOnly.
      { userId: 1, chatId: SRC, warnings: 2, warningReasons: ["a", "b"], isBanned: false, wasBanned: false },
      // Currently banned → copy, no warnings carried over.
      { userId: 2, chatId: SRC, username: "u2", name: "Two", warnings: 3, warningReasons: ["x"], isBanned: true, wasBanned: true },
      // Previously banned (wasBanned only) → still copied; G3 keeps wasBanned=true.
      { userId: 3, chatId: SRC, warnings: 0, warningReasons: [], isBanned: false, wasBanned: true },
      // No moderation state → ignored.
      { userId: 4, chatId: SRC, warnings: 0, warningReasons: [], isBanned: false, wasBanned: false },
    ] as never);

    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: false,
      domainAllowances: false,
      usersMode: "bansOnly",
      userExistingBehavior: "skip",
    });

    const calls = vi.mocked(userRepository.upsert).mock.calls.map((c) => c[0]);
    const ids = calls.map((c) => c.userId).sort();
    expect(ids).toEqual([2, 3]);
    for (const payload of calls) {
      expect(payload.chatId).toBe(DEST);
      expect(payload.warnings).toBe(0);
      expect(payload.warningReasons).toEqual([]);
      // G3: anyone reaching this branch should land wasBanned=true.
      expect(payload.wasBanned).toBe(true);
    }
    expect(summary.users).toBe(2);
    expect(summary.usersSkipped).toBe(0);
  });

  it("userExistingBehavior=skip: never upserts when a destination user already exists", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      { userId: 10, chatId: SRC, warnings: 0, warningReasons: [], isBanned: true, wasBanned: true },
      { userId: 11, chatId: SRC, warnings: 0, warningReasons: [], isBanned: true, wasBanned: true },
    ] as never);
    // 10 exists in dest (with prior warnings the user wants preserved); 11 does not.
    vi.mocked(userRepository.findByUserAndChat).mockImplementation(async (uid: number) => {
      if (uid === 10) return { userId: 10, chatId: DEST, warnings: 2, warningReasons: ["prior"] } as never;
      return null as never;
    });

    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: false,
      domainAllowances: false,
      usersMode: "bansOnly",
      userExistingBehavior: "skip",
    });

    expect(userRepository.upsert).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(userRepository.upsert).mock.calls[0][0];
    expect(payload.userId).toBe(11);
    expect(summary.users).toBe(1);
    expect(summary.usersMerged).toBe(0);
    expect(summary.usersSkipped).toBe(1);
  });

  it("userExistingBehavior=skip + 'all' mode: existing dest user is skipped, fresh ones upserted", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      { userId: 20, chatId: SRC, warnings: 1, warningReasons: ["spam"], isBanned: false, wasBanned: false },
      { userId: 21, chatId: SRC, warnings: 2, warningReasons: ["x", "y"], isBanned: false, wasBanned: false },
    ] as never);
    vi.mocked(userRepository.findByUserAndChat).mockImplementation(async (uid: number) => {
      if (uid === 20) return { userId: 20, chatId: DEST, warnings: 1, warningReasons: ["existing"] } as never;
      return null as never;
    });

    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: false,
      domainAllowances: false,
      usersMode: "all",
      userExistingBehavior: "skip",
    });

    expect(userRepository.upsert).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(userRepository.upsert).mock.calls[0][0];
    expect(payload.userId).toBe(21);
    expect(payload.warnings).toBe(2);
    expect(payload.warningReasons).toEqual(["x", "y"]);
    expect(summary.users).toBe(1);
    expect(summary.usersSkipped).toBe(1);
  });

  it("userExistingBehavior=merge + 'all' mode: max(warnings), union(reasons), OR(bans)", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      // src: lower warnings, new reason; dest has higher warnings + existing reason + ban.
      {
        userId: 40,
        chatId: SRC,
        warnings: 2,
        warningReasons: ["src-reason", "shared"],
        isBanned: false,
        wasBanned: false,
      },
      // dest absent → fresh create branch.
      {
        userId: 41,
        chatId: SRC,
        warnings: 1,
        warningReasons: ["only-src"],
        isBanned: false,
        wasBanned: false,
      },
    ] as never);
    vi.mocked(userRepository.findByUserAndChat).mockImplementation(async (uid: number) => {
      if (uid === 40)
        return {
          userId: 40,
          chatId: DEST,
          warnings: 5,
          warningReasons: ["dest-reason", "shared"],
          isBanned: true,
          wasBanned: true,
        } as never;
      return null as never;
    });

    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: false,
      domainAllowances: false,
      usersMode: "all",
      userExistingBehavior: "merge",
    });

    expect(userRepository.upsert).toHaveBeenCalledTimes(2);
    const byUser = Object.fromEntries(
      vi
        .mocked(userRepository.upsert)
        .mock.calls.map((c) => [c[0].userId, c[0]])
    );
    // Existing dest user → merged.
    expect(byUser[40].warnings).toBe(5); // max(2, 5)
    expect((byUser[40].warningReasons ?? []).sort()).toEqual(
      ["dest-reason", "shared", "src-reason"].sort()
    );
    expect(byUser[40].isBanned).toBe(true); // true OR false
    expect(byUser[40].wasBanned).toBe(true); // G3
    // Fresh user → straight copy.
    expect(byUser[41].warnings).toBe(1);
    expect(byUser[41].warningReasons).toEqual(["only-src"]);

    expect(summary.users).toBe(1);
    expect(summary.usersMerged).toBe(1);
    expect(summary.usersSkipped).toBe(0);
  });

  it("userExistingBehavior=merge + bansOnly: dest warnings preserved, ban flags OR'd", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      {
        userId: 50,
        chatId: SRC,
        warnings: 0,
        warningReasons: [],
        isBanned: true,
        wasBanned: true,
      },
    ] as never);
    // Dest user has prior warnings the user explicitly wants preserved.
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      userId: 50,
      chatId: DEST,
      warnings: 2,
      warningReasons: ["prior"],
      isBanned: false,
      wasBanned: false,
    } as never);

    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: true,
      bannedWords: false,
      domainAllowances: false,
      usersMode: "bansOnly",
      userExistingBehavior: "merge",
    });

    const payload = vi.mocked(userRepository.upsert).mock.calls[0][0];
    // Dest warnings/reasons preserved — bansOnly contributes no warning state.
    expect(payload.warnings).toBe(2);
    expect(payload.warningReasons).toEqual(["prior"]);
    // Ban flags OR'd in.
    expect(payload.isBanned).toBe(true);
    expect(payload.wasBanned).toBe(true);
    expect(summary.usersMerged).toBe(1);
    expect(summary.users).toBe(0);
  });

  it("back-compat: omitting options preserves full-copy behavior (bot command path)", async () => {
    mockChats();
    vi.mocked(userRepository.findAllByChatId).mockResolvedValue([
      { userId: 30, chatId: SRC, warnings: 1, warningReasons: ["spam"], isBanned: false, wasBanned: false },
    ] as never);
    vi.mocked(bannedWordRepository.findByChatAndScope).mockResolvedValue([
      { word: "foo", actions: { warn: true }, exactMatch: true, scope: "all" },
    ] as never);
    vi.mocked(userDomainAllowanceRepository.findByChatId).mockResolvedValue([
      { chatId: SRC, userId: 30, domains: ["a.com"] },
    ] as never);
    // Dest already has the user — without skipExistingUsers, the legacy path still upserts.
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      userId: 30,
      chatId: DEST,
      warnings: 5,
      isBanned: true,
      wasBanned: true,
    } as never);

    const summary = await migrateChatData(SRC, DEST, 7);

    expect(chatRepository.upsert).toHaveBeenCalledTimes(1);
    expect(userRepository.upsert).toHaveBeenCalledTimes(1);
    expect(bannedWordRepository.create).toHaveBeenCalledTimes(1);
    expect(userDomainAllowanceRepository.addDomain).toHaveBeenCalledTimes(1);
    expect(summary.usersSkipped).toBe(0);
    // G3 still respected in the legacy overwrite path.
    expect(vi.mocked(userRepository.upsert).mock.calls[0][0].wasBanned).toBe(true);
  });

  it("rejects when nothing is selected? — service trusts caller; route layer enforces it", async () => {
    // Caller is expected to validate "at least one entity"; the service itself simply no-ops
    // each disabled phase. This test pins that contract so refactors don't introduce a throw.
    mockChats();
    const summary = await migrateChatData(SRC, DEST, 7, {
      chatConfig: false,
      users: false,
      bannedWords: false,
      domainAllowances: false,
    });
    expect(chatRepository.upsert).not.toHaveBeenCalled();
    expect(userRepository.upsert).not.toHaveBeenCalled();
    expect(bannedWordRepository.create).not.toHaveBeenCalled();
    expect(userDomainAllowanceRepository.addDomain).not.toHaveBeenCalled();
    expect(summary).toEqual({
      sourceChatId: SRC,
      destChatId: DEST,
      users: 0,
      usersMerged: 0,
      usersSkipped: 0,
      bannedWords: 0,
      bannedWordsSkipped: 0,
      domainAllowances: 0,
      configCopied: false,
      logsTo: -9009,
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
