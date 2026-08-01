import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/repositories/topicRepository", () => ({
  topicRepository: {
    claimReminderSend: vi.fn(),
    recordReminderSent: vi.fn().mockResolvedValue(undefined),
    releaseReminderClaim: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { topicReminders } from "../../src/features/topicReminders";
import { topicRepository } from "../../src/db/repositories/topicRepository";
import { TOPIC_REMINDER_INTERVAL_MS } from "../../src/config/constants";
import { BotContext, IChat, ITopic } from "../../src/types";

const CHAT_ID = -1001234;
const TOPIC_ID = 7;

function makeChatConfig(overrides: Partial<IChat> = {}): IChat {
  return {
    chatId: CHAT_ID,
    name: "Test Group",
    type: "topics",
    isActive: true,
    features: { topicReminders: true },
    topicReminder: { button: { enabled: false, text: "", url: "" } },
    ...overrides,
  } as unknown as IChat;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const chat = { id: CHAT_ID, type: "supergroup" };
  const ctx = {
    chatConfig: makeChatConfig(),
    chat,
    message: {
      message_id: 42,
      chat,
      from: { id: 99, is_bot: false, first_name: "Alice" },
      date: 0,
      text: "hola",
      message_thread_id: TOPIC_ID,
    },
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 555 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  };
  return ctx as unknown as BotContext & {
    api: { sendMessage: ReturnType<typeof vi.fn>; deleteMessage: ReturnType<typeof vi.fn> };
  };
}

function makeTopic(reminder: Partial<NonNullable<ITopic["reminder"]>>): ITopic {
  return {
    chatId: CHAT_ID,
    topicId: TOPIC_ID,
    name: "Tema",
    allowedMsgTypes: [],
    reminder: { enabled: true, text: "Normas", lastSentAt: null, lastMessageId: null, ...reminder },
  } as unknown as ITopic;
}

describe("topicReminders middleware", () => {
  const claim = topicRepository.claimReminderSend as ReturnType<typeof vi.fn>;
  const record = topicRepository.recordReminderSent as ReturnType<typeof vi.fn>;
  const release = topicRepository.releaseReminderClaim as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue(null);
  });

  it("does nothing when the feature flag is off", async () => {
    const ctx = makeCtx({ chatConfig: makeChatConfig({ features: {} as IChat["features"] }) });
    const next = vi.fn();
    await topicReminders(ctx, next);
    expect(claim).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("ignores messages outside a topic (General has no Topic doc)", async () => {
    const ctx = makeCtx();
    (ctx.message as Record<string, unknown>).message_thread_id = undefined;
    const next = vi.fn();
    await topicReminders(ctx, next);
    expect(claim).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("claims with a cutoff one interval in the past", async () => {
    const ctx = makeCtx();
    const before = Date.now();
    await topicReminders(ctx, vi.fn());
    const cutoff = claim.mock.calls[0][2] as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - TOPIC_REMINDER_INTERVAL_MS - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - TOPIC_REMINDER_INTERVAL_MS + 50);
  });

  it("does not post when the claim fails (not due, or another message won the race)", async () => {
    claim.mockResolvedValue(null);
    const ctx = makeCtx();
    const next = vi.fn();
    await topicReminders(ctx, next);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("posts into the topic and stores the new message id", async () => {
    claim.mockResolvedValue(makeTopic({ text: "Normas del tema" }));
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());

    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = ctx.api.sendMessage.mock.calls[0];
    expect(chatId).toBe(CHAT_ID);
    expect(text).toBe("Normas del tema");
    expect(opts.message_thread_id).toBe(TOPIC_ID);
    expect(record).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, 555);
  });

  it("escapes the admin-authored text so it cannot break the HTML", async () => {
    claim.mockResolvedValue(makeTopic({ text: "<b>no</b> & <script>" }));
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage.mock.calls[0][1]).toBe("&lt;b&gt;no&lt;/b&gt; &amp; &lt;script&gt;");
  });

  it("deletes the previous reminder before posting the new one", async () => {
    claim.mockResolvedValue(makeTopic({ lastMessageId: 111 }));
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, 111);
  });

  it("still posts when deleting the previous reminder fails", async () => {
    claim.mockResolvedValue(makeTopic({ lastMessageId: 111 }));
    const ctx = makeCtx();
    ctx.api.deleteMessage.mockRejectedValue(new Error("message to delete not found"));
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, 555);
  });

  it("attaches the chat-wide button when it is configured", async () => {
    claim.mockResolvedValue(makeTopic({}));
    const ctx = makeCtx({
      chatConfig: makeChatConfig({
        topicReminder: { button: { enabled: true, text: "Ver grupos", url: "https://t.me/x" } },
      }),
    });
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage.mock.calls[0][2].reply_markup).toEqual({
      inline_keyboard: [[{ text: "Ver grupos", url: "https://t.me/x" }]],
    });
  });

  it("omits the button when it is enabled but incomplete", async () => {
    claim.mockResolvedValue(makeTopic({}));
    const ctx = makeCtx({
      chatConfig: makeChatConfig({
        topicReminder: { button: { enabled: true, text: "Ver grupos", url: "" } },
      }),
    });
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage.mock.calls[0][2].reply_markup).toBeUndefined();
  });

  it("releases the claim when the send fails, so the next message retries", async () => {
    const previous = new Date(Date.now() - 10 * 60 * 60 * 1000);
    claim.mockResolvedValue(makeTopic({ lastSentAt: previous }));
    const ctx = makeCtx();
    ctx.api.sendMessage.mockRejectedValue(new Error("chat not found"));
    await topicReminders(ctx, vi.fn());
    expect(release).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, previous);
    expect(record).not.toHaveBeenCalled();
  });

  it("releases the claim when the text is empty instead of posting a blank message", async () => {
    claim.mockResolvedValue(makeTopic({ text: "   " }));
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, null);
  });

  it("never throws and always continues the chain on a repository failure", async () => {
    claim.mockRejectedValue(new Error("mongo down"));
    const ctx = makeCtx();
    const next = vi.fn();
    await expect(topicReminders(ctx, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("stays independent of other feature flags (G16)", async () => {
    claim.mockResolvedValue(makeTopic({}));
    const ctx = makeCtx({
      chatConfig: makeChatConfig({
        features: {
          topicReminders: true,
          topicFiltering: false,
          welcomeMessage: false,
          csamDetection: false,
        } as IChat["features"],
      }),
    });
    await topicReminders(ctx, vi.fn());
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
