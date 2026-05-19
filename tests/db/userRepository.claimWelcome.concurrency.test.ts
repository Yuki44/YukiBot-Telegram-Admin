import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeUserModel } from "../helpers/fakeWelcomeStore";

const updateOne = vi.fn();

vi.mock("../../src/db/models/User", () => ({
  User: {
    updateOne: (...args: unknown[]) => updateOne(...args),
  },
}));

import { userRepository } from "../../src/db/repositories/userRepository";

describe("userRepository.claimWelcome — concurrency (exactly-once)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("200 concurrent claims for the SAME user → exactly one winner", async () => {
    // Several jittered iterations: interleaving must never produce 0 or >1 winners.
    for (let iter = 0; iter < 5; iter++) {
      const fake = makeFakeUserModel([{ userId: 7, chatId: -100 }], { jitter: true });
      updateOne.mockImplementation(fake.updateOne as never);

      const results = await Promise.all(
        Array.from({ length: 200 }, () => userRepository.claimWelcome(7, -100))
      );

      expect(results.filter((r) => r === true).length).toBe(1);
      expect(results.filter((r) => r === false).length).toBe(199);
      expect(fake.store.get("7:-100")?.welcomedAt).toBeInstanceOf(Date);
    }
  });

  it("200 concurrent claims for 200 DISTINCT users → all win exactly once", async () => {
    const seed = Array.from({ length: 200 }, (_, i) => ({ userId: i + 1, chatId: -100 }));
    const fake = makeFakeUserModel(seed, { jitter: true });
    updateOne.mockImplementation(fake.updateOne as never);

    const results = await Promise.all(
      seed.map((s) => userRepository.claimWelcome(s.userId, s.chatId))
    );

    expect(results.every((r) => r === true)).toBe(true);
    expect(results.length).toBe(200);
  });

  it("a claimed user can be released and then claimed again", async () => {
    const fake = makeFakeUserModel([{ userId: 7, chatId: -100, welcomedAt: new Date() }]);
    updateOne.mockImplementation(fake.updateOne as never);

    expect(await userRepository.claimWelcome(7, -100)).toBe(false);
    await userRepository.releaseWelcome(7, -100);
    expect(await userRepository.claimWelcome(7, -100)).toBe(true);
  });
});
