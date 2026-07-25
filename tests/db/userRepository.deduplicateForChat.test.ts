import { describe, it, expect, vi, beforeEach } from "vitest";

const aggregate = vi.fn();
const find = vi.fn();
const updateOne = vi.fn();
const deleteMany = vi.fn();
const syncIndexes = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/db/models/User", () => ({
  User: {
    aggregate: (...args: unknown[]) => aggregate(...args),
    find: (...args: unknown[]) => find(...args),
    updateOne: (...args: unknown[]) => updateOne(...args),
    deleteMany: (...args: unknown[]) => deleteMany(...args),
    syncIndexes: () => syncIndexes(),
  },
}));

import { userRepository } from "../../src/db/repositories/userRepository";

const CHAT = -100;

function doc(over: Record<string, unknown> = {}) {
  return {
    _id: `id-${Math.random().toString(36).slice(2)}`,
    userId: 1,
    chatId: CHAT,
    warnings: 0,
    warningReasons: [],
    isBanned: false,
    wasBanned: false,
    ...over,
  };
}

describe("userRepository.deduplicateForChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggregate.mockResolvedValue([]);
    find.mockResolvedValue([]);
    updateOne.mockResolvedValue({});
    deleteMany.mockResolvedValue({ deletedCount: 0 });
    syncIndexes.mockResolvedValue(undefined);
  });

  it("no duplicates → no writes, no syncIndexes failure", async () => {
    const result = await userRepository.deduplicateForChat(CHAT);

    expect(updateOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ duplicateGroups: 0, removed: 0, merged: 0 });
    // syncIndexes still attempted (best-effort).
    expect(syncIndexes).toHaveBeenCalledTimes(1);
  });

  it("merges duplicates: max warnings, union reasons, OR(isBanned/wasBanned); deletes losers", async () => {
    aggregate.mockResolvedValue([{ _id: 1, ids: ["A", "B", "C"], count: 3 }]);
    find.mockResolvedValue([
      doc({ _id: "A", userId: 1, warnings: 1, warningReasons: ["spam"], isBanned: false, wasBanned: false }),
      doc({ _id: "B", userId: 1, warnings: 3, warningReasons: ["link"], isBanned: true, wasBanned: true }),
      doc({ _id: "C", userId: 1, warnings: 2, warningReasons: ["spam", "abuse"], isBanned: false, wasBanned: false, username: "ux", name: "User X" }),
    ]);
    deleteMany.mockResolvedValue({ deletedCount: 2 });

    const result = await userRepository.deduplicateForChat(CHAT);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    // Winner is B (highest warnings + banned).
    expect(filter).toEqual({ _id: "B" });
    expect(update.$set.warnings).toBe(3);
    expect((update.$set.warningReasons as string[]).sort()).toEqual(["abuse", "link", "spam"]);
    expect(update.$set.isBanned).toBe(true);
    expect(update.$set.wasBanned).toBe(true);
    // Identity prefers a non-empty username/name from any of the docs.
    expect(update.$set.username).toBe("ux");
    expect(update.$set.name).toBe("User X");

    // Losers deleted.
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const [deleteFilter] = deleteMany.mock.calls[0];
    const deletedIds = (deleteFilter._id as { $in: string[] }).$in.sort();
    expect(deletedIds).toEqual(["A", "C"]);

    expect(result).toEqual({ duplicateGroups: 1, removed: 2, merged: 1 });
  });

  it("G3: wasBanned stays true even when isBanned is false everywhere", async () => {
    aggregate.mockResolvedValue([{ _id: 7, ids: ["X", "Y"], count: 2 }]);
    find.mockResolvedValue([
      doc({ _id: "X", userId: 7, warnings: 0, isBanned: false, wasBanned: true }),
      doc({ _id: "Y", userId: 7, warnings: 0, isBanned: false, wasBanned: false }),
    ]);

    await userRepository.deduplicateForChat(CHAT);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.wasBanned).toBe(true);
    expect(update.$set.isBanned).toBe(false);
  });

  it("isBanned forces wasBanned=true even if no doc had wasBanned set (G3)", async () => {
    aggregate.mockResolvedValue([{ _id: 8, ids: ["P", "Q"], count: 2 }]);
    find.mockResolvedValue([
      doc({ _id: "P", userId: 8, warnings: 0, isBanned: true, wasBanned: false }),
      doc({ _id: "Q", userId: 8, warnings: 0, isBanned: false, wasBanned: false }),
    ]);

    await userRepository.deduplicateForChat(CHAT);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.isBanned).toBe(true);
    expect(update.$set.wasBanned).toBe(true);
  });

  it("syncIndexes failure does not throw", async () => {
    aggregate.mockResolvedValue([]);
    syncIndexes.mockRejectedValue(new Error("index already exists with different options"));

    await expect(userRepository.deduplicateForChat(CHAT)).resolves.toEqual({
      duplicateGroups: 0,
      removed: 0,
      merged: 0,
    });
  });
});
