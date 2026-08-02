import { describe, it, expect, vi, beforeEach } from "vitest";

const findOne = vi.fn();
const find = vi.fn();
const deleteOne = vi.fn();
const updateOne = vi.fn();

vi.mock("../../src/db/models/User", () => ({
  User: {
    findOne: (...a: unknown[]) => findOne(...a),
    find: (...a: unknown[]) => find(...a),
    deleteOne: (...a: unknown[]) => deleteOne(...a),
    updateOne: (...a: unknown[]) => updateOne(...a),
  },
}));

import { userRepository } from "../../src/db/repositories/userRepository";

const USER = 42;
const CHAT = -100111;

beforeEach(() => {
  vi.clearAllMocks();
  deleteOne.mockResolvedValue({});
  updateOne.mockResolvedValue({});
});

describe("markNotMember (finding #1 exit policy)", () => {
  it("deletes a clean row — nothing worth keeping about a user who left", async () => {
    findOne.mockResolvedValue({ userId: USER, chatId: CHAT, warnings: 0, wasBanned: false, isBanned: false });
    expect(await userRepository.markNotMember(USER, CHAT)).toBe(true);
    expect(deleteOne).toHaveBeenCalledWith({ userId: USER, chatId: CHAT });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("keeps a warned row, stamping both the exit date and the scan exclusion", async () => {
    findOne.mockResolvedValue({ userId: USER, chatId: CHAT, warnings: 2, wasBanned: false, isBanned: false });
    expect(await userRepository.markNotMember(USER, CHAT)).toBe(false);
    expect(deleteOne).not.toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.notMemberAt).toBeInstanceOf(Date);
    expect(update.$set.leftWithWarningsAt).toBeInstanceOf(Date);
  });

  // G3: a banned row is the auto-reban record. It is excluded from the scan, never deleted.
  it("never deletes a row of a user who was ever banned", async () => {
    findOne.mockResolvedValue({ userId: USER, chatId: CHAT, warnings: 0, wasBanned: true, isBanned: false });
    expect(await userRepository.markNotMember(USER, CHAT)).toBe(false);
    expect(deleteOne).not.toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.notMemberAt).toBeInstanceOf(Date);
    expect(update.$set.leftWithWarningsAt).toBeUndefined();
  });

  it("does nothing when the row is already gone", async () => {
    findOne.mockResolvedValue(null);
    expect(await userRepository.markNotMember(USER, CHAT)).toBe(false);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe("findDueForBioScan", () => {
  it("scans only users actually inside the chat", async () => {
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    find.mockReturnValue(chain);

    await userRepository.findDueForBioScan([CHAT], new Date(), 1);

    const [query] = find.mock.calls[0] as [Record<string, unknown>];
    expect(query.isBanned).toEqual({ $ne: true });
    const clauses = query.$and as { $or: Record<string, unknown>[] }[];
    expect(clauses[0].$or[0]).toEqual({ notMemberAt: { $exists: false } });
    expect(clauses[1].$or[0]).toEqual({ leftWithWarningsAt: { $exists: false } });
  });

  // R2, second half: leftWithWarningsAt retains the row for 180 days, but it must not double as
  // a permanent scan ban — a warned user who quietly rejoins would never be covered again.
  it("brings a row benched with warnings back on the same window", async () => {
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    find.mockReturnValue(chain);
    const recheckBefore = new Date("2026-07-01T00:00:00Z");

    await userRepository.findDueForBioScan([CHAT], new Date(), 1, recheckBefore);

    const [query] = find.mock.calls[0] as [Record<string, unknown>];
    expect(query.leftWithWarningsAt).toBeUndefined(); // no longer a hard exclusion
    const clauses = query.$and as { $or: Record<string, unknown>[] }[];
    expect(clauses[1].$or).toEqual([
      { leftWithWarningsAt: { $exists: false } },
      { leftWithWarningsAt: { $lt: recheckBefore } },
    ]);
  });

  // R2: a rejoin the bot never saw must not exclude a user from CSAM coverage for good.
  it("brings a benched row back after the re-probe window", async () => {
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    find.mockReturnValue(chain);
    const recheckBefore = new Date("2026-07-01T00:00:00Z");

    await userRepository.findDueForBioScan([CHAT], new Date(), 1, recheckBefore);

    const [query] = find.mock.calls[0] as [{ $and: Record<string, unknown>[][] }];
    const presence = (query.$and as unknown as { $or: Record<string, unknown>[] }[])[0];
    expect(presence.$or).toEqual([
      { notMemberAt: { $exists: false } },
      { notMemberAt: { $lt: recheckBefore } },
    ]);
  });
});

describe("clearLeftDate", () => {
  it("clears both exit markers so a rejoining user is scanned again", async () => {
    await userRepository.clearLeftDate(USER, CHAT);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$unset).toEqual({ leftWithWarningsAt: "", notMemberAt: "" });
  });
});
