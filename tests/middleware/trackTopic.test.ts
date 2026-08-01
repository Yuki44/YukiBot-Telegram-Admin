import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/repositories/topicRepository", () => ({
  topicRepository: { recordSeen: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { trackTopic } from "../../src/bot/middleware/trackTopic";
import { topicRepository } from "../../src/db/repositories/topicRepository";
import { BotContext, IChat } from "../../src/types";

const makeCtx = (type: IChat["type"], threadId?: number, chatId = -100123) =>
  ({
    chat: { id: chatId, type: "supergroup" },
    chatConfig: { chatId, type } as unknown as IChat,
    message: { message_id: 1, message_thread_id: threadId },
  }) as unknown as BotContext;

describe("trackTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records topics in forum chats", async () => {
    await trackTopic(makeCtx("topics", 7, -100999), vi.fn());
    expect(topicRepository.recordSeen).toHaveBeenCalledWith(-100999, 7);
  });

  it("ignores reply threads in normal chats", async () => {
    await trackTopic(makeCtx("normal", 7, -100888), vi.fn());
    expect(topicRepository.recordSeen).not.toHaveBeenCalled();
  });

  it("ignores messages outside any thread", async () => {
    await trackTopic(makeCtx("topics", undefined, -100777), vi.fn());
    expect(topicRepository.recordSeen).not.toHaveBeenCalled();
  });
});
