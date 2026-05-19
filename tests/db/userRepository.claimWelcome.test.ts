import { describe, it, expect, vi, beforeEach } from "vitest";

const updateOne = vi.fn();

vi.mock("../../src/db/models/User", () => ({
  User: {
    updateOne: (...args: unknown[]) => updateOne(...args),
  },
}));

import { userRepository } from "../../src/db/repositories/userRepository";

describe("userRepository.claimWelcome / releaseWelcome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims with the exists-guard filter and a welcomedAt Date, returning true on modifiedCount 1", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const ok = await userRepository.claimWelcome(7, -100);

    expect(ok).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: 7, chatId: -100, welcomedAt: { $exists: false } });
    expect(update.$set.welcomedAt).toBeInstanceOf(Date);
  });

  it("returns false when nothing was modified (already welcomed / lost the race)", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 0 });
    expect(await userRepository.claimWelcome(7, -100)).toBe(false);
  });

  it("returns false when the doc does not exist", async () => {
    updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect(await userRepository.claimWelcome(7, -100)).toBe(false);
  });

  it("releaseWelcome unsets welcomedAt", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await userRepository.releaseWelcome(7, -100);

    expect(updateOne).toHaveBeenCalledWith(
      { userId: 7, chatId: -100 },
      { $unset: { welcomedAt: "" } }
    );
  });
});
