import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import {
  topicReminders,
  flushTopicReminder,
  resetTopicReminderState,
} from "../../src/features/topicReminders";
import { topicRepository } from "../../src/db/repositories/topicRepository";
import {
  TOPIC_REMINDER_INTERVAL_MS,
  TOPIC_REMINDER_DEBOUNCE_MS,
  TOPIC_REMINDER_MAX_WAIT_MS,
} from "../../src/config/constants";
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

function makeApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 555 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
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
    api: makeApi(),
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

const claim = topicRepository.claimReminderSend as ReturnType<typeof vi.fn>;
const record = topicRepository.recordReminderSent as ReturnType<typeof vi.fn>;
const release = topicRepository.releaseReminderClaim as ReturnType<typeof vi.fn>;

describe("flushTopicReminder — the send flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue(null);
  });

  it("claims with a cutoff one interval in the past", async () => {
    const api = makeApi();
    const before = Date.now();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    const cutoff = claim.mock.calls[0][2] as Date;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - TOPIC_REMINDER_INTERVAL_MS - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - TOPIC_REMINDER_INTERVAL_MS + 50);
  });

  it("does not post when the claim fails (not due, or another path won the race)", async () => {
    claim.mockResolvedValue(null);
    const api = makeApi();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("posts into the topic and stores the new message id", async () => {
    claim.mockResolvedValue(makeTopic({ text: "Normas del tema" }));
    const api = makeApi();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = api.sendMessage.mock.calls[0];
    expect(chatId).toBe(CHAT_ID);
    expect(text).toBe("Normas del tema");
    expect(opts.message_thread_id).toBe(TOPIC_ID);
    expect(record).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, 555);
  });

  it("escapes the admin-authored text so it cannot break the HTML", async () => {
    claim.mockResolvedValue(makeTopic({ text: "<b>no</b> & <script>" }));
    const api = makeApi();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(api.sendMessage.mock.calls[0][1]).toBe("&lt;b&gt;no&lt;/b&gt; &amp; &lt;script&gt;");
  });

  it("deletes the previous reminder before posting the new one", async () => {
    claim.mockResolvedValue(makeTopic({ lastMessageId: 111 }));
    const api = makeApi();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, 111);
  });

  it("still posts when deleting the previous reminder fails", async () => {
    claim.mockResolvedValue(makeTopic({ lastMessageId: 111 }));
    const api = makeApi();
    api.deleteMessage.mockRejectedValue(new Error("message to delete not found"));
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, 555);
  });

  it("attaches the chat-wide button when it is configured", async () => {
    claim.mockResolvedValue(makeTopic({}));
    const api = makeApi();
    const config = makeChatConfig({
      topicReminder: { button: { enabled: true, text: "Ver grupos", url: "https://t.me/x" } },
    });
    await flushTopicReminder(api as never, config, CHAT_ID, TOPIC_ID);
    expect(api.sendMessage.mock.calls[0][2].reply_markup).toEqual({
      inline_keyboard: [[{ text: "Ver grupos", url: "https://t.me/x" }]],
    });
  });

  it("omits the button when it is enabled but incomplete", async () => {
    claim.mockResolvedValue(makeTopic({}));
    const api = makeApi();
    const config = makeChatConfig({
      topicReminder: { button: { enabled: true, text: "Ver grupos", url: "" } },
    });
    await flushTopicReminder(api as never, config, CHAT_ID, TOPIC_ID);
    expect(api.sendMessage.mock.calls[0][2].reply_markup).toBeUndefined();
  });

  it("releases the claim when the send fails, so the next message retries", async () => {
    const previous = new Date(Date.now() - 10 * 60 * 60 * 1000);
    claim.mockResolvedValue(makeTopic({ lastSentAt: previous }));
    const api = makeApi();
    api.sendMessage.mockRejectedValue(new Error("chat not found"));
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(release).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, previous);
    expect(record).not.toHaveBeenCalled();
  });

  it("releases the claim when the text is empty instead of posting a blank message", async () => {
    claim.mockResolvedValue(makeTopic({ text: "   " }));
    const api = makeApi();
    await flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, null);
  });

  it("never throws on a repository failure", async () => {
    claim.mockRejectedValue(new Error("mongo down"));
    const api = makeApi();
    await expect(
      flushTopicReminder(api as never, makeChatConfig(), CHAT_ID, TOPIC_ID)
    ).resolves.toBeUndefined();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe("topicReminders middleware — debounce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTopicReminderState();
    vi.useFakeTimers();
    claim.mockResolvedValue(makeTopic({ text: "Normas" }));
  });
  afterEach(() => {
    resetTopicReminderState();
    vi.useRealTimers();
  });

  it("does nothing when the feature flag is off", async () => {
    const ctx = makeCtx({ chatConfig: makeChatConfig({ features: {} as IChat["features"] }) });
    const next = vi.fn();
    await topicReminders(ctx, next);
    await vi.advanceTimersByTimeAsync(TOPIC_REMINDER_MAX_WAIT_MS + TOPIC_REMINDER_DEBOUNCE_MS);
    expect(claim).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("ignores messages outside a topic (General has no Topic doc)", async () => {
    const ctx = makeCtx();
    (ctx.message as Record<string, unknown>).message_thread_id = undefined;
    const next = vi.fn();
    await topicReminders(ctx, next);
    await vi.advanceTimersByTimeAsync(TOPIC_REMINDER_DEBOUNCE_MS);
    expect(claim).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("does not post immediately — it waits for the quiet window", async () => {
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());
    await vi.advanceTimersByTimeAsync(TOPIC_REMINDER_DEBOUNCE_MS - 1);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("re-arms on each new message so it lands after the sender's burst", async () => {
    const ctx = makeCtx();
    await topicReminders(ctx, vi.fn());
    // Three quick follow-ups, each 4s apart — never idle long enough to fire.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(4000);
      await topicReminders(ctx, vi.fn());
      expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    }
    // Burst ends → quiet window elapses → exactly one reminder.
    await vi.advanceTimersByTimeAsync(TOPIC_REMINDER_DEBOUNCE_MS);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("fires under the max-wait cap even if the topic never falls quiet", async () => {
    const ctx = makeCtx();
    // Message every 5s forever: the debounce keeps resetting, but the cap must win.
    for (let elapsed = 0; elapsed <= TOPIC_REMINDER_MAX_WAIT_MS; elapsed += 5000) {
      await topicReminders(ctx, vi.fn());
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("always continues the chain", async () => {
    const ctx = makeCtx();
    const next = vi.fn();
    await topicReminders(ctx, next);
    expect(next).toHaveBeenCalled();
  });
});
