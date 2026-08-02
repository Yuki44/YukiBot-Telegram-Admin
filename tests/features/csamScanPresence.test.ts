import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../../src/config/constants", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, CSAM_SCAN_SPACING_MS: 0, CSAM_SCAN_BATCH: 1 };
});

vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: { listAll: vi.fn(), findByChatId: vi.fn(async () => null) },
}));

vi.mock("../../src/db/repositories/csamWatchlistRepository", () => ({
  csamWatchlistRepository: {
    getConfig: vi.fn(async () => ({ handles: [], solicitation: [], negation: [] })),
  },
}));

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findDueForBioScan: vi.fn(),
    findByUserAndChat: vi.fn(async () => null),
    markBioChecked: vi.fn(async () => {}),
    recordBioMiss: vi.fn(async () => 1),
    clearBioMiss: vi.fn(async () => {}),
    markNotMember: vi.fn(async () => true),
    syncPhotoAcrossChats: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/features/nameTracking", () => ({ trackIdentity: vi.fn(async () => {}) }));

import { runBioScanBatch, isDefinitiveAbsence } from "../../src/features/csamDetection/scanner";
import { userRepository } from "../../src/db/repositories/userRepository";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { trackIdentity } from "../../src/features/nameTracking";
import { CSAM_SCAN_MISS_LIMIT } from "../../src/config/constants";

const CHAT = -100111;
const USER = 4242;
const actor = { id: 1, name: "Yuki", username: "yukibot" };

function chatConfig(features: Record<string, boolean> = {}) {
  return {
    chatId: CHAT,
    name: "G@Y",
    isActive: true,
    features: { csamDetection: true, ...features },
  };
}

function makeBot(overrides: Record<string, unknown> = {}) {
  return {
    api: {
      getChat: vi.fn(async () => ({ id: USER, first_name: "Simon", username: "simon" })),
      getChatMember: vi.fn(async () => ({ status: "member", user: { id: USER, first_name: "Simon" } })),
      ...overrides,
    },
    botInfo: { id: 1, first_name: "Yuki", username: "yukibot" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatRepository.listAll).mockResolvedValue([chatConfig()] as never);
  vi.mocked(userRepository.findDueForBioScan).mockResolvedValue([
    { userId: USER, chatId: CHAT, name: "Simo" },
  ] as never);
  vi.mocked(userRepository.recordBioMiss).mockResolvedValue(1);
  vi.mocked(userRepository.markNotMember).mockResolvedValue(true);
});

describe("presence probe (finding #1)", () => {
  it("does not probe while getChat still resolves the user", async () => {
    const bot = makeBot();
    await runBioScanBatch(bot, actor);
    expect(bot.api.getChatMember).not.toHaveBeenCalled();
    expect(userRepository.clearBioMiss).toHaveBeenCalledWith(USER, CHAT);
  });

  it("does not probe before the miss limit is reached", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT - 1);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
    });
    await runBioScanBatch(bot, actor);
    expect(bot.api.getChatMember).not.toHaveBeenCalled();
    expect(userRepository.markNotMember).not.toHaveBeenCalled();
  });

  it("prunes the row once getChatMember confirms the user left", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => ({ status: "left", user: { id: USER, first_name: "Simon" } })),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).toHaveBeenCalledWith(USER, CHAT);
    expect(trackIdentity).not.toHaveBeenCalled();
  });

  it("treats an unresolvable member as absent rather than retrying forever", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => {
        throw new Error("400: user not found");
      }),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).toHaveBeenCalledWith(USER, CHAT);
  });

  it("keeps a still-present lurker and harvests the identity getChat could not give", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    vi.mocked(chatRepository.listAll).mockResolvedValue([
      chatConfig({ trackNameChanges: true }),
    ] as never);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => ({
        status: "member",
        user: { id: USER, first_name: "Simon", last_name: "B", username: "simon" },
      })),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).not.toHaveBeenCalled();
    expect(trackIdentity).toHaveBeenCalledWith(bot.api, expect.anything(), USER, CHAT, {
      name: "Simon B",
      username: "simon",
    });
  });

  // R1: an outage or a demoted bot makes every probe in a chat fail at once. Reading that as
  // absence would delete good rows wholesale, so an inconclusive answer must never prune.
  it("never prunes when the probe fails for a chat-level reason", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => {
        throw Object.assign(new Error("403"), { description: "Forbidden: bot is not a member of the group chat" });
      }),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).not.toHaveBeenCalled();
  });

  it("never prunes on a transient network error", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => {
        throw new Error("ETIMEDOUT");
      }),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).not.toHaveBeenCalled();
  });

  it("prunes on a definitive per-user answer (deleted account)", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => {
        throw Object.assign(new Error("400"), { description: "Bad Request: user not found" });
      }),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).toHaveBeenCalledWith(USER, CHAT);
  });

  // G16: the probe belongs to csamDetection; the identity it yields is a rider on it.
  it("probes and prunes without announcing when trackNameChanges is off", async () => {
    vi.mocked(userRepository.recordBioMiss).mockResolvedValue(CSAM_SCAN_MISS_LIMIT);
    const bot = makeBot({
      getChat: vi.fn(async () => {
        throw new Error("400: chat not found");
      }),
      getChatMember: vi.fn(async () => ({ status: "left", user: { id: USER, first_name: "Simon" } })),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.markNotMember).toHaveBeenCalledWith(USER, CHAT);
    expect(trackIdentity).not.toHaveBeenCalled();
  });
});

describe("isDefinitiveAbsence", () => {
  it.each([
    ["Bad Request: user not found", true],
    ["Bad Request: USER_ID_INVALID", true],
    ["Bad Request: PEER_ID_INVALID", true],
    ["Bad Request: chat not found", false],
    ["Forbidden: bot is not a member of the supergroup chat", false],
    ["Too Many Requests: retry after 30", false],
    ["ETIMEDOUT", false],
  ])("%s → %s", (description, expected) => {
    expect(isDefinitiveAbsence({ description })).toBe(expected);
  });
});

describe("profile photo cached from the scan (finding #5)", () => {
  it("stores the avatar the getChat response already carried", async () => {
    const bot = makeBot({
      getChat: vi.fn(async () => ({
        id: USER,
        first_name: "Simon",
        photo: { small_file_id: "AgACsmall", big_file_id: "AgACbig" },
      })),
    });
    await runBioScanBatch(bot, actor);
    expect(userRepository.syncPhotoAcrossChats).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ photoFileId: "AgACsmall" })
    );
    expect(bot.api.getChatMember).not.toHaveBeenCalled();
  });

  it("never blanks a stored avatar when the response carries no photo", async () => {
    const bot = makeBot();
    await runBioScanBatch(bot, actor);
    const photoWrites = vi
      .mocked(userRepository.syncPhotoAcrossChats)
      .mock.calls.filter(([, fields]) => "photoFileId" in fields);
    expect(photoWrites).toHaveLength(0);
  });
});
