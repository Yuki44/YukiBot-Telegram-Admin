import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/repositories/topicRepository", () => ({
  topicRepository: { findByChatAndTopic: vi.fn() },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { topicFiltering } from "../../src/features/topicFiltering";
import { topicRepository } from "../../src/db/repositories/topicRepository";
import { BotContext, IChat, ITopic, VALID_CONTENT_TYPES } from "../../src/types";

const CHAT_ID = -100777;
const TOPIC_ID = 5;

const makeCtx = (message: Record<string, unknown>) => {
  const chat = { id: CHAT_ID, type: "supergroup" };
  const deleteMessage = vi.fn().mockResolvedValue(true);
  const ctx = {
    isAdmin: false,
    chatConfig: { features: { topicFiltering: true } } as unknown as IChat,
    chat,
    message: { message_id: 1, chat, date: 0, message_thread_id: TOPIC_ID, ...message },
    deleteMessage,
  } as unknown as BotContext;
  return { ctx, deleteMessage };
};

const topic = (allowedMsgTypes: string[], isUserConfigured = false): ITopic =>
  ({ chatId: CHAT_ID, topicId: TOPIC_ID, allowedMsgTypes, isUserConfigured }) as unknown as ITopic;

describe("topicFiltering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("honours the stored list even when the topic was never user-configured", async () => {
    vi.mocked(topicRepository.findByChatAndTopic).mockResolvedValue(topic(["text"], false));
    const { ctx, deleteMessage } = makeCtx({ photo: [] });

    await topicFiltering(ctx, vi.fn());

    expect(deleteMessage).toHaveBeenCalled();
  });

  it("allows a type present in the stored list", async () => {
    vi.mocked(topicRepository.findByChatAndTopic).mockResolvedValue(topic([...VALID_CONTENT_TYPES]));
    const { ctx, deleteMessage } = makeCtx({ animation: {} });

    await topicFiltering(ctx, vi.fn());

    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("never deletes content the admin cannot deselect", async () => {
    vi.mocked(topicRepository.findByChatAndTopic).mockResolvedValue(topic(["text"]));
    const { ctx, deleteMessage } = makeCtx({ dice: {} });

    await topicFiltering(ctx, vi.fn());

    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
