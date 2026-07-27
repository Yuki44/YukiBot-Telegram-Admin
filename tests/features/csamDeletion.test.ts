import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { deleteMessagesConfirmed } from "../../src/features/csamDetection/actions";

// Minimal grammy Api stub — only the two delete methods matter here.
function makeApi(over: Record<string, unknown> = {}) {
  return {
    deleteMessages: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("deleteMessagesConfirmed", () => {
  it("bulk-deletes in a single call on the happy path and confirms every id", async () => {
    const api = makeApi();
    const res = await deleteMessagesConfirmed(api, -100, [1, 2, 3]);
    expect(res.deleted).toEqual([1, 2, 3]);
    expect(res.failed).toEqual([]);
    expect(api.deleteMessages).toHaveBeenCalledTimes(1);
    expect(api.deleteMessage).not.toHaveBeenCalled();
  });

  it("falls back to per-message when one poison id fails the whole batch — deletable ones still go", async () => {
    const api = makeApi({
      deleteMessages: vi.fn(async () => {
        throw new Error("Bad Request: message can't be deleted");
      }),
      deleteMessage: vi.fn(async (_chatId: number, id: number) => {
        if (id === 2) throw new Error("Bad Request: message to delete not found");
        return true;
      }),
    });
    const res = await deleteMessagesConfirmed(api, -100, [1, 2, 3]);
    // The CSAM image (say, id 1 or 3) is no longer shielded by the poison id 2.
    expect(res.deleted).toEqual([1, 3]);
    expect(res.failed).toEqual([{ id: 2, reason: expect.stringContaining("not found") }]);
    expect(api.deleteMessage).toHaveBeenCalledTimes(3);
  });

  it("chunks into groups of 100", async () => {
    const api = makeApi();
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const res = await deleteMessagesConfirmed(api, -100, ids);
    expect(api.deleteMessages).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(res.deleted).toHaveLength(250);
  });

  it("no-ops cleanly on an empty id list", async () => {
    const api = makeApi();
    const res = await deleteMessagesConfirmed(api, -100, []);
    expect(res.deleted).toEqual([]);
    expect(res.failed).toEqual([]);
    expect(api.deleteMessages).not.toHaveBeenCalled();
  });
});
