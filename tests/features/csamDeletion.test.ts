import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));
vi.mock("../../src/db/repositories/csamRecentMessageRepository", () => ({
  csamRecentMessageRepository: { findMessages: vi.fn() },
}));

import { deleteMessagesConfirmed, deleteRecentMessages } from "../../src/features/csamDetection/actions";
import { csamRecentMessageRepository } from "../../src/db/repositories/csamRecentMessageRepository";
import { logger } from "../../src/utils/logger";

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

describe("deleteRecentMessages — on-ban bulk delete logs the image removal", () => {
  const actor = { id: 1, name: "YukiBot" };
  const target = { userId: 555, name: "bad actor" };

  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
  });

  it("emits csam_image_deleted for each media message removed (not for text ones)", async () => {
    vi.mocked(csamRecentMessageRepository.findMessages).mockResolvedValue([
      { messageId: 10, hasMedia: true }, // the CSAM image
      { messageId: 11, hasMedia: false }, // a text message
    ]);
    const api = makeApi();
    await deleteRecentMessages(api, -100, 555, actor, target, "CP/impostor");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "csam_image_deleted", messageId: 10, via: "bio_bulk_delete" })
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "csam_image_deleted", messageId: 11 })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "csam_bulk_delete", deleted: 2, deletedMedia: 1 })
    );
  });

  it("reports zero media when the user's tracked messages were all text", async () => {
    vi.mocked(csamRecentMessageRepository.findMessages).mockResolvedValue([{ messageId: 20, hasMedia: false }]);
    await deleteRecentMessages(makeApi(), -100, 555, actor, target, "CP/impostor");
    expect(logger.info).not.toHaveBeenCalledWith(expect.objectContaining({ action: "csam_image_deleted" }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "csam_bulk_delete", deletedMedia: 0 })
    );
  });
});
