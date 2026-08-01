import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrammyError } from "grammy";

vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: { listAll: vi.fn() },
}));
vi.mock("../../src/db/repositories/topicRepository", () => ({
  topicRepository: {
    findAllByChatId: vi.fn(),
    recordMissing: vi.fn(),
    clearMissing: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/db/repositories/bannedWordRepository", () => ({
  bannedWordRepository: { removeByTopic: vi.fn().mockResolvedValue(2) },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { runTopicSweep, classifyProbe } from "../../src/features/topicSync/sweep";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { topicRepository } from "../../src/db/repositories/topicRepository";
import { bannedWordRepository } from "../../src/db/repositories/bannedWordRepository";
import { placeholderTopicName } from "../../src/utils/topicName";
import { BotContext, IChat, ITopic } from "../../src/types";
import type { Bot } from "grammy";

const CHAT_ID = -100555;

const grammyError = (description: string): GrammyError =>
  new GrammyError(
    "Call to editForumTopic failed",
    { ok: false, error_code: 400, description },
    "editForumTopic",
    {}
  );

const makeBot = (editForumTopic: unknown, isForum = true) =>
  ({
    api: { editForumTopic, getChat: vi.fn().mockResolvedValue({ id: CHAT_ID, is_forum: isForum }) },
  }) as unknown as Bot<BotContext>;

const topic = (topicId: number, name: string): ITopic =>
  ({ chatId: CHAT_ID, topicId, name }) as unknown as ITopic;

const chat = (overrides: Partial<IChat> = {}): IChat =>
  ({ chatId: CHAT_ID, type: "topics", isActive: true, ...overrides }) as unknown as IChat;

describe("classifyProbe", () => {
  it("treats only TOPIC_ID_INVALID as deleted", () => {
    expect(classifyProbe(false, grammyError("Bad Request: TOPIC_ID_INVALID"))).toBe("deleted");
    expect(classifyProbe(false, grammyError("Bad Request: TOPIC_NOT_MODIFIED"))).toBe("alive");
    expect(classifyProbe(false, grammyError("Bad Request: TOPIC_CLOSED"))).toBe("alive");
    expect(classifyProbe(false, grammyError("Too Many Requests: retry after 30"))).toBe("alive");
    expect(classifyProbe(false, new Error("socket hang up"))).toBe("alive");
  });

  it("flags a successful edit as a stale-name rename", () => {
    expect(classifyProbe(true, null)).toBe("renamed");
  });
});

describe("runTopicSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chatRepository.listAll).mockResolvedValue([chat()]);
    vi.mocked(bannedWordRepository.removeByTopic).mockResolvedValue(2);
  });

  it("deletes a missing topic only on the second consecutive strike", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([
      topic(20, "Mi polla/mi culo"),
      topic(21, "Pajas now"),
    ]);
    const edit = vi.fn().mockImplementation((_chatId: number, topicId: number) => {
      throw grammyError(topicId === 20 ? "Bad Request: TOPIC_ID_INVALID" : "Bad Request: TOPIC_NOT_MODIFIED");
    });
    vi.mocked(topicRepository.recordMissing).mockResolvedValue(1);

    await runTopicSweep(makeBot(edit));

    expect(topicRepository.recordMissing).toHaveBeenCalledWith(CHAT_ID, 20);
    expect(topicRepository.deleteOne).not.toHaveBeenCalled();

    vi.mocked(topicRepository.recordMissing).mockResolvedValue(2);
    await runTopicSweep(makeBot(edit));

    expect(topicRepository.deleteOne).toHaveBeenCalledWith(CHAT_ID, 20);
    expect(bannedWordRepository.removeByTopic).toHaveBeenCalledWith(CHAT_ID, 20);
  });

  it("resets the strike counter for a live topic", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([topic(15, "Barcelona")]);
    const edit = vi.fn().mockRejectedValue(grammyError("Bad Request: TOPIC_NOT_MODIFIED"));

    await runTopicSweep(makeBot(edit));

    expect(topicRepository.clearMissing).toHaveBeenCalledWith(CHAT_ID, 15);
    expect(topicRepository.deleteOne).not.toHaveBeenCalled();
  });

  it("deletes nothing when every probe in a chat fails", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([
      topic(15, "Barcelona"),
      topic(16, "Girona"),
    ]);
    vi.mocked(topicRepository.recordMissing).mockResolvedValue(9);
    const edit = vi.fn().mockRejectedValue(grammyError("Bad Request: TOPIC_ID_INVALID"));

    await runTopicSweep(makeBot(edit));

    expect(topicRepository.recordMissing).not.toHaveBeenCalled();
    expect(topicRepository.deleteOne).not.toHaveBeenCalled();
  });

  it("never probes a placeholder-named topic", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([
      topic(30, placeholderTopicName(30)),
      topic(31, "Info"),
    ]);
    const edit = vi.fn().mockRejectedValue(grammyError("Bad Request: TOPIC_NOT_MODIFIED"));

    await runTopicSweep(makeBot(edit));

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith(CHAT_ID, 31, { name: "Info" });
  });

  it("skips a chat whose forum mode is off", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([topic(15, "Barcelona")]);
    const edit = vi.fn();

    await runTopicSweep(makeBot(edit, false));

    expect(edit).not.toHaveBeenCalled();
    expect(topicRepository.deleteOne).not.toHaveBeenCalled();
  });

  it("skips non-topics and inactive chats", async () => {
    vi.mocked(chatRepository.listAll).mockResolvedValue([
      chat({ type: "normal" }),
      chat({ isActive: false }),
    ]);
    const edit = vi.fn();

    await runTopicSweep(makeBot(edit));

    expect(edit).not.toHaveBeenCalled();
  });

  it("does not delete a topic whose stale name got applied", async () => {
    vi.mocked(topicRepository.findAllByChatId).mockResolvedValue([
      topic(40, "Nombre viejo"),
      topic(41, "Info"),
    ]);
    const edit = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValue(grammyError("Bad Request: TOPIC_NOT_MODIFIED"));

    await runTopicSweep(makeBot(edit));

    expect(topicRepository.deleteOne).not.toHaveBeenCalled();
    expect(topicRepository.recordMissing).not.toHaveBeenCalled();
  });
});
