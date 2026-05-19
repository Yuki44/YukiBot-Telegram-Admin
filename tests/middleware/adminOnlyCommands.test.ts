import { describe, it, expect, vi } from "vitest";
import { adminOnlyCommands } from "../../src/bot/middleware/adminOnlyCommands";
import { BotContext } from "../../src/types";

function makeCtx(overrides: Record<string, unknown> = {}): BotContext {
  return {
    message: undefined,
    isAdmin: false,
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as BotContext;
}

describe("adminOnlyCommands", () => {
  it("calls next() for non-command messages", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ message: { text: "hello world" } });
    await adminOnlyCommands(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() for commands not in the protected set", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ message: { text: "/start" } });
    await adminOnlyCommands(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks a protected command from non-admin and deletes the message", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      message: { text: "/av @user reason" },
      isAdmin: false,
      deleteMessage: deleteFn,
    });
    await adminOnlyCommands(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalledOnce();
  });

  it("allows a protected command from admin", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({
      message: { text: "/av @user reason" },
      isAdmin: true,
    });
    await adminOnlyCommands(ctx, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("handles all registered YukiBot commands", async () => {
    const commands = [
      "setup", "migrar", "addtopic", "edittopic", "removetopic", "togglefeature",
      "av", "elav", "qav", "avs", "qban", "sil", "elsil", "silav",
      "elsilav", "qsil", "qsilav", "com", "kk", "bn",
    ];

    for (const cmd of commands) {
      const next = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        message: { text: `/${cmd}` },
        isAdmin: false,
        deleteMessage: vi.fn().mockResolvedValue(undefined),
      });
      await adminOnlyCommands(ctx, next);
      expect(next).not.toHaveBeenCalled();
    }
  });
});

