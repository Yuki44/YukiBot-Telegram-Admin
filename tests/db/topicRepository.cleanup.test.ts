import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteMany = vi.fn();
const updateMany = vi.fn();

vi.mock("../../src/db/models/Topic", () => ({
  Topic: {
    deleteMany: (...args: unknown[]) => deleteMany(...args),
    updateMany: (...args: unknown[]) => updateMany(...args),
  },
}));

import { topicRepository } from "../../src/db/repositories/topicRepository";
import { TOPIC_TYPES_VERSION } from "../../src/config/constants";
import { VALID_CONTENT_TYPES } from "../../src/types";

describe("topicRepository.deleteOutsideChats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMany.mockResolvedValue({ deletedCount: 3 });
  });

  it("keeps only rows belonging to known forum chats", async () => {
    const removed = await topicRepository.deleteOutsideChats([-1001, -1002]);

    expect(deleteMany).toHaveBeenCalledWith({ chatId: { $nin: [-1001, -1002] } });
    expect(removed).toBe(3);
  });

  it("deletes nothing when the forum chat list is empty", async () => {
    const removed = await topicRepository.deleteOutsideChats([]);

    expect(deleteMany).not.toHaveBeenCalled();
    expect(removed).toBe(0);
  });
});

describe("topicRepository.backfillNewMsgTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ modifiedCount: 4 });
  });

  it("grants the current type set only to rows below the current version", async () => {
    await topicRepository.backfillNewMsgTypes();

    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({
      $or: [{ typesVersion: { $exists: false } }, { typesVersion: { $lt: TOPIC_TYPES_VERSION } }],
    });
    expect(update.$addToSet.allowedMsgTypes.$each).toEqual([...VALID_CONTENT_TYPES]);
    expect(update.$set.typesVersion).toBe(TOPIC_TYPES_VERSION);
  });
});
