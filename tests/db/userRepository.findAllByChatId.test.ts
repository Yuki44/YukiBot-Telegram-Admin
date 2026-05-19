import { describe, it, expect, vi, beforeEach } from "vitest";

const find = vi.fn();

vi.mock("../../src/db/models/User", () => ({
  User: {
    find: (...args: unknown[]) => find(...args),
  },
}));

import { userRepository } from "../../src/db/repositories/userRepository";

describe("userRepository.findAllByChatId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries by chatId only, with no limit/sort, and returns the rows", async () => {
    const rows = [{ userId: 1 }, { userId: 2 }];
    find.mockResolvedValue(rows);

    const result = await userRepository.findAllByChatId(-100);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ chatId: -100 });
    expect(result).toBe(rows);
  });
});
