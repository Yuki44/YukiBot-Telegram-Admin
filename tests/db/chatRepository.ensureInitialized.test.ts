import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// Repository-level test: mock the Mongoose model, never the DB.

const findOne = vi.fn();
const findOneAndUpdate = vi.fn();

vi.mock("../../src/db/models/Chat", () => ({
  Chat: {
    findOne: (...args: unknown[]) => findOne(...args),
    findOneAndUpdate: (...args: unknown[]) => findOneAndUpdate(...args),
  },
}));

import { chatRepository } from "../../src/db/repositories/chatRepository";

// `.lean()` is what the repo calls on the findOne result.
function mockExisting(doc: Record<string, unknown> | null) {
  findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(doc) });
}

/** Extract the $set object handed to Chat.findOneAndUpdate. */
function capturedSet(): Record<string, unknown> {
  const call = findOneAndUpdate.mock.calls[0];
  return (call[1] as { $set: Record<string, unknown> }).$set;
}

const META = { name: "My Chat", type: "normal" as const };

const ALL_FEATURE_KEYS = [
  "features.languageDetection",
  "features.topicFiltering",
  "features.autoBan",
  "features.autoWarnSpam",
  "features.promoSpamDetection",
  "features.bannedWordsEnforcement",
];

const ALL_LOGFLAG_KEYS = [
  "logFlags.logWarns",
  "logFlags.logSilences",
  "logFlags.logBans",
  "logFlags.logAutoRebans",
  "logFlags.logKicks",
  "logFlags.logQBans",
  "logFlags.logUnsilences",
  "logFlags.logUnwarns",
  "logFlags.logEntries",
  "logFlags.logExits",
  "logFlags.logBannedWords",
];

describe("chatRepository.ensureInitialized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOneAndUpdate.mockResolvedValue({ chatId: 1, ...META });
  });

  it("first run (no existing doc) initializes every field with defaults off except isActive", async () => {
    mockExisting(null);

    await chatRepository.ensureInitialized(1, META);

    const $set = capturedSet();
    expect($set.name).toBe("My Chat");
    expect($set.type).toBe("normal");
    expect($set.isActive).toBe(true);
    expect($set.whitelist).toBe(false);
    expect($set.linkWhitelist).toEqual([]);
    expect($set.spamUserWhitelist).toEqual([]);
    expect($set.hiddenAdminIds).toEqual([]);
    expect($set.delegatedOwnerId).toBeNull();
    expect($set.forwardsTo).toBeNull();
    expect($set.logsTo).toBeNull();
    for (const k of ALL_FEATURE_KEYS) expect($set[k]).toBe(false);
    for (const k of ALL_LOGFLAG_KEYS) expect($set[k]).toBe(false);

    // Telemetry/photo fields are intentionally left to schema `default: undefined`.
    expect($set).not.toHaveProperty("members");
    expect($set).not.toHaveProperty("photoFileId");

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { chatId: 1 },
      { $set },
      { upsert: true, returnDocument: "after" }
    );
  });

  it("second run on a fully-populated doc only re-syncs name & type", async () => {
    mockExisting({
      chatId: 1,
      name: "Old Name",
      type: "topics",
      isActive: true,
      whitelist: true,
      linkWhitelist: ["a.com"],
      spamUserWhitelist: [5],
      hiddenAdminIds: [],
      delegatedOwnerId: 7,
      forwardsTo: -100,
      logsTo: -200,
      features: {
        languageDetection: false,
        topicFiltering: true,
        autoBan: true,
        autoWarnSpam: false,
        promoSpamDetection: false,
        bannedWordsEnforcement: false,
      },
      logFlags: {
        logWarns: true,
        logSilences: false,
        logBans: false,
        logAutoRebans: false,
        logKicks: false,
        logQBans: false,
        logUnsilences: false,
        logUnwarns: false,
        logEntries: false,
        logExits: false,
        logBannedWords: false,
      },
    });

    await chatRepository.ensureInitialized(1, META);

    const $set = capturedSet();
    expect(Object.keys($set).sort()).toEqual(["name", "type"]);
    expect($set.name).toBe("My Chat");
    expect($set.type).toBe("normal");
  });

  it("backfills only the missing keys without clobbering enabled ones", async () => {
    mockExisting({
      chatId: 1,
      name: "Old",
      type: "normal",
      isActive: true,
      whitelist: true,
      linkWhitelist: [],
      spamUserWhitelist: [],
      hiddenAdminIds: [],
      delegatedOwnerId: null,
      forwardsTo: null,
      // logsTo missing → must be backfilled
      features: {
        languageDetection: false,
        topicFiltering: true,
        autoBan: true,
        autoWarnSpam: false,
        promoSpamDetection: false,
        // bannedWordsEnforcement missing → must be backfilled
      },
      logFlags: {
        logWarns: true,
        logSilences: false,
        logBans: false,
        logAutoRebans: false,
        logKicks: false,
        logQBans: false,
        logUnsilences: false,
        logUnwarns: false,
        logEntries: false,
        logExits: false,
        logBannedWords: false,
      },
    });

    await chatRepository.ensureInitialized(1, META);

    const $set = capturedSet();
    expect(Object.keys($set).sort()).toEqual(
      ["features.bannedWordsEnforcement", "logsTo", "name", "type"].sort()
    );
    expect($set["features.bannedWordsEnforcement"]).toBe(false);
    expect($set.logsTo).toBeNull();
    // Enabled values were NOT re-set.
    expect($set).not.toHaveProperty("whitelist");
    expect($set).not.toHaveProperty("features.autoBan");
    expect($set).not.toHaveProperty("logFlags.logWarns");
  });

  it("legacy doc with no features/logFlags objects backfills all of them", async () => {
    mockExisting({
      chatId: 1,
      name: "Legacy",
      type: "normal",
      isActive: true,
      whitelist: false,
      linkWhitelist: [],
      spamUserWhitelist: [],
      hiddenAdminIds: [],
      delegatedOwnerId: null,
      forwardsTo: null,
      logsTo: null,
      // features and logFlags entirely absent
    });

    await chatRepository.ensureInitialized(1, META);

    const $set = capturedSet();
    for (const k of ALL_FEATURE_KEYS) expect($set[k]).toBe(false);
    for (const k of ALL_LOGFLAG_KEYS) expect($set[k]).toBe(false);
    // Existing top-level values left untouched.
    expect($set).not.toHaveProperty("whitelist");
    expect($set).not.toHaveProperty("isActive");
  });

  it("returns the updated document", async () => {
    mockExisting(null);
    findOneAndUpdate.mockResolvedValue({ chatId: 1, name: "My Chat", type: "normal" });

    const result = await chatRepository.ensureInitialized(1, META);

    expect(result).toEqual({ chatId: 1, name: "My Chat", type: "normal" });
  });
});
