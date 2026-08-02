import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn(async () => ({})),
    syncPhotoAcrossChats: vi.fn(async () => {}),
    clearLeftDate: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/bot/helpers/lastMessageTracker", () => ({ trackLastMessage: vi.fn() }));

import { trackUser } from "../../src/bot/middleware/trackUser";
import { userRepository } from "../../src/db/repositories/userRepository";
import { BotContext } from "../../src/types";

const next = vi.fn(async () => {});

function ctx(chatId: number, type: string, userId: number): BotContext {
  return {
    from: { id: userId, is_bot: false, first_name: "Simon", username: "simon" },
    chat: { id: chatId, type },
    message: { message_id: 7 },
  } as unknown as BotContext;
}

beforeEach(() => vi.clearAllMocks());

describe("trackUser (finding #3: phantom rows)", () => {
  it("never creates a row for a private chat — the userId is not a chatId", async () => {
    await trackUser(ctx(555001, "private", 555001), next);
    expect(userRepository.findOrCreate).not.toHaveBeenCalled();
    expect(userRepository.syncPhotoAcrossChats).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  // Identity here only seeds a new row; findOrCreate never overwrites it, so the
  // comparison in nameChangeTracker still sees the previous name.
  it("creates the membership row seeding the identity", async () => {
    await trackUser(ctx(-100222, "supergroup", 555002), next);
    expect(userRepository.findOrCreate).toHaveBeenCalledWith(555002, -100222, "simon", "Simon");
    expect(next).toHaveBeenCalled();
  });

  // R2: posting is proof of presence — it must undo a bench the scanner applied.
  it("clears the exit markers when a benched user speaks again", async () => {
    await trackUser(ctx(-100222, "supergroup", 555003), next);
    expect(userRepository.clearLeftDate).toHaveBeenCalledWith(555003, -100222);
  });

  it("does not touch exit markers for a private chat", async () => {
    await trackUser(ctx(555004, "private", 555004), next);
    expect(userRepository.clearLeftDate).not.toHaveBeenCalled();
  });
});
