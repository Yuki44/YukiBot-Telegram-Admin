import { describe, it, expect, vi } from "vitest";
import { sendBroadcastPost } from "../../src/bot/helpers/sendBroadcastPost";
import { Bot } from "grammy";
import { BotContext, IBroadcastPost, IChannelBroadcast } from "../../src/types";

vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeBot(overrides: Record<string, unknown> = {}) {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 555 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 777 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      ...overrides,
    },
  } as unknown as Bot<BotContext>;
}

const post: IBroadcastPost = {
  key: "a",
  label: "A",
  caption: "Únete",
  url: "https://t.me/+abc",
  image: null,
  hours: [10],
  enabled: true,
  lastSentSlot: null,
  retryAttempts: 0,
  lastMessageId: null,
};
const button: IChannelBroadcast["button"] = { enabled: false, text: "" };

describe("sendBroadcastPost — replace previous", () => {
  it("returns the new message_id and deletes the previous post", async () => {
    const bot = makeBot();
    const id = await sendBroadcastPost(bot, -100123, post, button, 999);
    expect(id).toBe(555);
    expect(bot.api.deleteMessage).toHaveBeenCalledWith(-100123, 999);
  });

  it("does not delete when there is no previous message", async () => {
    const bot = makeBot();
    await sendBroadcastPost(bot, -100123, post, button, null);
    expect(bot.api.deleteMessage).not.toHaveBeenCalled();
  });

  it("swallows a failed delete of the previous post (new one still stands)", async () => {
    const bot = makeBot({ deleteMessage: vi.fn().mockRejectedValue(new Error("message to delete not found")) });
    const id = await sendBroadcastPost(bot, -100123, post, button, 999);
    expect(id).toBe(555);
  });
});
