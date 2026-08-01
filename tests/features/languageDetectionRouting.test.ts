import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn(),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/db/repositories/csamRecentMessageRepository", () => ({
  csamRecentMessageRepository: { findMessageIdsSince: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../src/features/csamDetection/actions", () => ({
  deleteMessagesConfirmed: vi.fn().mockResolvedValue({ deleted: [], failed: [] }),
}));
vi.mock("../../src/bot/helpers/applyWarn", () => ({
  applyWarn: vi.fn().mockResolvedValue({ banned: false, warningsAfter: 2 }),
}));
vi.mock("../../src/bot/helpers/forwardToLog", () => ({
  forwardToLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { handleLanguageOffense } from "../../src/features/languageDetection/actions";
import { userRepository } from "../../src/db/repositories/userRepository";
import { applyWarn } from "../../src/bot/helpers/applyWarn";
import { recordActivity } from "../../src/utils/activityLog";
import { BotContext, IUser } from "../../src/types";

const target = { userId: 42, name: "Harry", username: "hrushbsbbd" };

const message = {
  message_id: 7,
  chat: { id: -1001234, type: "supergroup" },
  from: { id: 42, is_bot: false, first_name: "Harry" },
  date: 0,
  text: "hello everyone",
} as never;

function makeCtx() {
  return {
    chatConfig: { chatId: -1001234, name: "Test Group", type: "normal", features: {} },
    me: { id: 1, first_name: "YukiBot", username: "yukibot" },
    chat: { id: -1001234, title: "Test Group" },
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 8 }),
      restrictChatMember: vi.fn().mockResolvedValue(true),
    },
  } as unknown as BotContext;
}

function mockUser(user: Partial<IUser> | null): void {
  (userRepository.findByUserAndChat as ReturnType<typeof vi.fn>).mockResolvedValue(user);
}

describe("handleLanguageOffense — grace routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants grace when the user has no prior grace and no warnings", async () => {
    mockUser({ warnings: 0 } as IUser);
    const ctx = makeCtx();

    await handleLanguageOffense(ctx, target, message);

    expect(applyWarn).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).toHaveBeenCalled();
  });

  it("skips grace and warns directly when the user already has warnings", async () => {
    mockUser({ warnings: 1 } as IUser);
    const ctx = makeCtx();

    await handleLanguageOffense(ctx, target, message);

    expect(applyWarn).toHaveBeenCalled();
  });

  it("marks the grace as consumed when it is skipped due to prior warnings", async () => {
    mockUser({ warnings: 2 } as IUser);

    await handleLanguageOffense(makeCtx(), target, message);

    expect(userRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, languageGraceGivenAt: expect.any(Date) })
    );
  });

  it("warns directly once the grace has already been spent", async () => {
    mockUser({ warnings: 0, languageGraceGivenAt: new Date() } as IUser);

    await handleLanguageOffense(makeCtx(), target, message);

    expect(applyWarn).toHaveBeenCalled();
  });

  it("never silences the user — enforcement is elav, not elsilav", async () => {
    mockUser({ warnings: 1 } as IUser);
    const ctx = makeCtx();

    await handleLanguageOffense(ctx, target, message);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(userRepository.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ isMuted: true }));
    expect(recordActivity).not.toHaveBeenCalledWith(expect.objectContaining({ type: "silence" }));
  });
});
