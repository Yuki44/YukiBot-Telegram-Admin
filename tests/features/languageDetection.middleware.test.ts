import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/features/languageDetection/preScreen", () => ({
  isCandidate: vi.fn(),
  countWords: vi.fn().mockReturnValue(10),
}));
vi.mock("../../src/features/languageDetection/localDetect", () => ({
  detectLocally: vi.fn().mockResolvedValue({ skip: false }),
}));
vi.mock("../../src/features/languageDetection/classifier", () => ({
  classifyLanguage: vi.fn(),
}));
vi.mock("../../src/features/languageDetection/actions", () => ({
  handleLanguageOffense: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/db/repositories/adminRepository", () => ({
  adminRepository: { isChatAdmin: vi.fn().mockResolvedValue(false) },
}));
vi.mock("../../src/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { languageDetection } from "../../src/features/languageDetection";
import { isCandidate } from "../../src/features/languageDetection/preScreen";
import { detectLocally } from "../../src/features/languageDetection/localDetect";
import { classifyLanguage } from "../../src/features/languageDetection/classifier";
import { handleLanguageOffense } from "../../src/features/languageDetection/actions";
import { adminRepository } from "../../src/db/repositories/adminRepository";
import { BotContext, IChat } from "../../src/types";

function makeChatConfig(overrides: Partial<IChat> = {}): IChat {
  return {
    chatId: -1001234,
    name: "Test Group",
    type: "normal",
    isActive: true,
    whitelist: false,
    spamUserWhitelist: [],
    features: { languageDetection: true },
    ...overrides,
  } as unknown as IChat;
}

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  const baseMsg = {
    message_id: 42,
    chat: { id: -1001234, type: "supergroup" },
    from: { id: 99, is_bot: false, first_name: "Alice" },
    date: 0,
    text: "My flight got delayed again, this airline is a joke honestly.",
  };
  return {
    chatConfig: makeChatConfig(),
    isAdmin: false,
    me: { id: 1, first_name: "YukiBot", username: "yukibot" },
    message: baseMsg,
    chat: baseMsg.chat,
    ...overrides,
  } as unknown as BotContext;
}

describe("languageDetection — middleware chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminRepository.isChatAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (isCandidate as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (detectLocally as ReturnType<typeof vi.fn>).mockResolvedValue({ skip: false });
    (classifyLanguage as ReturnType<typeof vi.fn>).mockResolvedValue({ verdict: "FOREIGN_BLATANT" });
  });

  it("skips the classifier when the local detector is confident it is Spanish/Catalan", async () => {
    (detectLocally as ReturnType<typeof vi.fn>).mockResolvedValue({ skip: true, language: "es", confidence: 0.8 });
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(classifyLanguage).not.toHaveBeenCalled();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("still classifies when the local detector is unsure — doubt costs a call, never a miss", async () => {
    (detectLocally as ReturnType<typeof vi.fn>).mockResolvedValue({ skip: false, language: "en" });
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(classifyLanguage).toHaveBeenCalled();
    expect(handleLanguageOffense).toHaveBeenCalled();
  });

  it("calls next() when the feature flag is off", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx({ chatConfig: makeChatConfig({ features: {} as IChat["features"] }) }), next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("calls next() for admin author (G4)", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx({ isAdmin: true }), next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("calls next() when message has no text or caption", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      message: {
        message_id: 42,
        chat: { id: -1001234, type: "supergroup" },
        from: { id: 99, is_bot: false, first_name: "Alice" },
        date: 0,
        sticker: { file_id: "s1" },
      },
    });
    await languageDetection(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() for a whitelisted user", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ chatConfig: makeChatConfig({ spamUserWhitelist: [99] }) });
    await languageDetection(ctx, next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("calls next() for a DB-confirmed admin", async () => {
    (adminRepository.isChatAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("calls next() when Stage 1 filters the message out", async () => {
    (isCandidate as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(classifyLanguage).not.toHaveBeenCalled();
  });

  it("calls next() when Stage 2 says ES_CA", async () => {
    (classifyLanguage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ verdict: "ES_CA" });
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("calls next() when Stage 2 says UNSURE", async () => {
    (classifyLanguage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ verdict: "UNSURE" });
    const next = vi.fn().mockResolvedValue(undefined);
    await languageDetection(makeCtx(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(handleLanguageOffense).not.toHaveBeenCalled();
  });

  it("dispatches to handleLanguageOffense and does not call next() on a FOREIGN_BLATANT hit", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx();
    await languageDetection(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(handleLanguageOffense).toHaveBeenCalledWith(
      ctx,
      { userId: 99, name: "Alice", username: undefined },
      ctx.message
    );
  });
});
