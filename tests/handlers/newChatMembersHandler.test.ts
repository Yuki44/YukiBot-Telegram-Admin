import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotContext } from "../../src/types";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findOrCreate: vi.fn(),
    clearLeftDate: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/bot/helpers/sendLog", () => ({ sendLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/bot/helpers/sendWelcome", () => ({ sendWelcome: vi.fn().mockResolvedValue(true) }));
vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));

import { newChatMembersHandler } from "../../src/bot/handlers/newChatMembersHandler";
import { userRepository } from "../../src/db/repositories/userRepository";
import { sendWelcome } from "../../src/bot/helpers/sendWelcome";
import { recordActivity } from "../../src/utils/activityLog";
import { resetWelcomeTracker, clearRecentWelcome } from "../../src/bot/helpers/welcomeTracker";

const CHAT_ID = -100123;

type Member = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };

function makeCtx(
  members: Member[],
  opts: { chatConfig?: unknown; autoBan?: boolean; welcomeMessage?: boolean } = {}
): BotContext {
  const chatConfig =
    "chatConfig" in opts
      ? opts.chatConfig
      : {
          type: "normal",
          logsTo: null,
          features: { autoBan: opts.autoBan ?? false, welcomeMessage: opts.welcomeMessage ?? true },
          welcome: { message: "Hola @usuario a @nombreGrupo", button: { enabled: false, text: "", url: "" } },
        };
  return {
    message: { new_chat_members: members },
    chat: { id: CHAT_ID, type: "supergroup", title: "Test Group" },
    me: { id: 999 },
    chatConfig,
    api: {
      banChatMember: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("newChatMembersHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWelcomeTracker();
    vi.mocked(userRepository.findOrCreate).mockResolvedValue({
      userId: 7,
      chatId: CHAT_ID,
      wasBanned: false,
    } as never);
    vi.mocked(sendWelcome).mockResolvedValue(true);
  });

  it("welcomes a user added to the group (the trigger chat_member misses)", async () => {
    const ctx = makeCtx([{ id: 7, is_bot: false, first_name: "Neo", username: "neo" }]);
    await newChatMembersHandler(ctx as never);

    expect(sendWelcome).toHaveBeenCalledTimes(1);
    expect(sendWelcome).toHaveBeenCalledWith(
      ctx.api,
      CHAT_ID,
      (ctx.chatConfig as { welcome: unknown }).welcome,
      { id: 7, username: "neo", name: "Neo" },
      "Test Group"
    );
  });

  it("skips bots, including YukiBot itself being added", async () => {
    const ctx = makeCtx([
      { id: 999, is_bot: true, first_name: "YukiBot" },
      { id: 5, is_bot: true, first_name: "OtherBot" },
    ]);
    await newChatMembersHandler(ctx as never);

    expect(userRepository.findOrCreate).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("auto-bans a re-entering banned user instead of welcoming", async () => {
    vi.mocked(userRepository.findOrCreate).mockResolvedValue({
      userId: 7,
      chatId: CHAT_ID,
      wasBanned: true,
    } as never);
    const ctx = makeCtx([{ id: 7, is_bot: false, first_name: "Neo", username: "neo" }], {
      autoBan: true,
    });

    await newChatMembersHandler(ctx as never);

    expect(ctx.api!.banChatMember).toHaveBeenCalledWith(CHAT_ID, 7);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "autoban", chatId: CHAT_ID })
    );
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("does nothing when the chat is not configured/active (chatConfig null)", async () => {
    const ctx = makeCtx([{ id: 7, is_bot: false, first_name: "Neo" }], { chatConfig: null });
    await newChatMembersHandler(ctx as never);

    expect(userRepository.findOrCreate).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("the chat_member + new_chat_members overlap for one entry greets only once", async () => {
    const make = () => makeCtx([{ id: 7, is_bot: false, first_name: "Neo", username: "neo" }]);
    await newChatMembersHandler(make() as never);
    await newChatMembersHandler(make() as never);
    expect(sendWelcome).toHaveBeenCalledTimes(1);
  });

  it("greets again on a later re-entry once the guard is cleared on leave", async () => {
    const make = () => makeCtx([{ id: 7, is_bot: false, first_name: "Neo", username: "neo" }]);
    await newChatMembersHandler(make() as never);
    expect(sendWelcome).toHaveBeenCalledTimes(1);

    // The user left — chatMemberHandler clears the guard on its left/kicked path.
    clearRecentWelcome(CHAT_ID, 7);

    await newChatMembersHandler(make() as never);
    expect(sendWelcome).toHaveBeenCalledTimes(2);
  });

  it("processes every member when several are added in one message", async () => {
    vi.mocked(userRepository.findOrCreate).mockImplementation(
      async (userId: number) => ({ userId, chatId: CHAT_ID, wasBanned: false }) as never
    );
    const ctx = makeCtx([
      { id: 1, is_bot: false, first_name: "A", username: "a" },
      { id: 2, is_bot: false, first_name: "B", username: "b" },
      { id: 3, is_bot: false, first_name: "C", username: "c" },
    ]);

    await newChatMembersHandler(ctx as never);

    expect(sendWelcome).toHaveBeenCalledTimes(3);
    const greeted = new Set(vi.mocked(sendWelcome).mock.calls.map((c) => (c[3] as { id: number }).id));
    expect(greeted).toEqual(new Set([1, 2, 3]));
  });
});
