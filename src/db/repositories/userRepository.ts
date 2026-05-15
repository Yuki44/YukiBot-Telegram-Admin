import { PipelineStage } from "mongoose";
import { User } from "../models/User";
import { IUser } from "../../types";
import { MAX_WARNINGS } from "../../config/constants";

export type UserListFilter = "all" | "warned" | "silenced" | "banned";

export const userRepository = {
  async findByUserAndChat(userId: number, chatId: number): Promise<IUser | null> {
    return await User.findOne({ userId, chatId });
  },

  async listByChatId(
    chatId: number,
    opts: { filter?: UserListFilter; q?: string; limit?: number } = {}
  ): Promise<IUser[]> {
    const filter = opts.filter ?? "all";
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);

    const query: Record<string, unknown> = { chatId };
    if (filter === "warned") query.warnings = { $gt: 0 };
    else if (filter === "silenced") query.isMuted = true;
    else if (filter === "banned") query.isBanned = true;

    if (opts.q) {
      const escaped = opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      // Search by name, username, or numeric ID
      const orClauses: Record<string, unknown>[] = [{ name: rx }, { username: rx }];
      const numeric = Number(opts.q);
      if (Number.isFinite(numeric)) orClauses.push({ userId: numeric });
      query.$or = orClauses;
    }

    // Aggregation pipeline (instead of plain find + sort) because some legacy User docs
    // don't have `warnings` / `isMuted` / `isBanned` fields at all (mongoose schema
    // defaults aren't applied to upserts that don't pass setDefaultsOnInsert). $ifNull
    // coerces missing values so the sort is consistent regardless of doc shape.
    //
    // Tier order — active first, then warned, then silenced, then banned:
    //   _statusTier = isBanned ? 3 : isMuted ? 2 : warnings>0 ? 1 : 0
    // Within each tier, sort alphabetically by name with Spanish, case-insensitive collation.
    // Exception: inside the "warned" filter every row is tier 1, so sort by warnings ASC
    // (1/3 → 2/3 → 3/3) before falling back to name. Inside "banned", everyone is tier 3,
    // so we push nameless rows ("Sin nombre" in the UI) to the bottom via _hasName DESC.
    const sortStage: PipelineStage.Sort["$sort"] =
      filter === "warned"
        ? { _warnings: 1, _sortName: 1 }
        : filter === "banned"
          ? { _hasName: -1, _sortName: 1 }
          : { _statusTier: 1, _sortName: 1 };

    const pipeline: PipelineStage[] = [
      { $match: query },
      {
        $addFields: {
          _statusTier: {
            $cond: [
              { $eq: [{ $ifNull: ["$isBanned", false] }, true] },
              3,
              {
                $cond: [
                  { $eq: [{ $ifNull: ["$isMuted", false] }, true] },
                  2,
                  {
                    $cond: [
                      { $gt: [{ $ifNull: ["$warnings", 0] }, 0] },
                      1,
                      0,
                    ],
                  },
                ],
              },
            ],
          },
          _warnings: { $ifNull: ["$warnings", 0] },
          _sortName: { $ifNull: ["$name", { $ifNull: ["$username", ""] }] },
          // Mirrors UsersScreen's `noName = !name && !username` after trim.
          // Trim with $trim before checking length so whitespace-only doesn't count.
          _hasName: {
            $cond: [
              {
                $or: [
                  { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$name", ""] } } } }, 0] },
                  { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$username", ""] } } } }, 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
      { $sort: sortStage },
      { $limit: limit },
      { $project: { _statusTier: 0, _warnings: 0, _sortName: 0, _hasName: 0 } },
    ];

    return await User.aggregate<IUser>(pipeline).collation({ locale: "es", strength: 1 });
  },

  async findByUsername(username: string, chatId: number): Promise<IUser | null> {
    return await User.findOne({ username, chatId });
  },

  async upsert(user: Partial<IUser>): Promise<IUser> {
    if (!user.userId || !user.chatId) {
      throw new Error("userId and chatId are required for upsert");
    }

    return await User.findOneAndUpdate(
      { userId: user.userId, chatId: user.chatId },
      { $set: user },
      // setDefaultsOnInsert ensures schema defaults (warnings: 0, isMuted: false, etc.)
      // are written when a new doc is created — otherwise sort/filter on those fields
      // misses the doc entirely.
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  },

  async findOrCreate(userId: number, chatId: number, username?: string, name?: string): Promise<IUser> {
    const update: Record<string, unknown> = {
      $setOnInsert: {
        userId,
        chatId,
        warnings: 0,
        warningReasons: [],
        isBanned: false,
        wasBanned: false,
      },
    };

    const setFields: Record<string, unknown> = {};
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    if (Object.keys(setFields).length > 0) {
      update.$set = setFields;
    }

    return await User.findOneAndUpdate({ userId, chatId }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    });
  },

  async incrementWarning(
    userId: number,
    chatId: number,
    reason?: string,
    username?: string,
    name?: string
  ): Promise<IUser> {
    const update: Record<string, unknown> = {
      $setOnInsert: {
        userId,
        chatId,
        warnings: 0,
        warningReasons: [],
        isBanned: false,
        wasBanned: false,
      },
    };

    const setFields: Record<string, unknown> = {};
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    if (Object.keys(setFields).length > 0) {
      update.$set = setFields;
    }

    const user = await User.findOneAndUpdate({ userId, chatId }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    });

    user.warnings += 1;
    if (reason) user.warningReasons.push(reason);

    if (user.warnings >= MAX_WARNINGS) {
      user.isBanned = true;
      user.wasBanned = true;
    }

    await user.save();
    return user;
  },

  async remove(userId: number, chatId: number): Promise<void> {
    await User.deleteOne({ userId, chatId });
  },

  /**
   * Propagate identity-only fields (name/username/photoFileId/photoCheckedAt) across
   * every chat that already has this userId. Per-chat enforcement state — wasBanned,
   * isBanned, warnings, isMuted — is deliberately NOT synced (G3): those are chat-scoped.
   *
   * Empty/whitespace name and username are dropped so we never overwrite real identity
   * with a blank value from a stripped-down Telegram update.
   */
  async syncIdentityAcrossChats(
    userId: number,
    fields: {
      name?: string | null;
      username?: string | null;
      photoFileId?: string | null;
      photoCheckedAt?: Date;
    }
  ): Promise<void> {
    const setFields: Record<string, unknown> = {};
    if (typeof fields.name === "string" && fields.name.trim().length > 0) {
      setFields.name = fields.name.trim();
    }
    if (typeof fields.username === "string" && fields.username.trim().length > 0) {
      setFields.username = fields.username.trim();
    }
    if (fields.photoFileId !== undefined) {
      setFields.photoFileId = fields.photoFileId;
    }
    if (fields.photoCheckedAt !== undefined) {
      setFields.photoCheckedAt = fields.photoCheckedAt;
    }
    if (Object.keys(setFields).length === 0) return;

    try {
      await User.updateMany({ userId }, { $set: setFields });
    } catch (err) {
      // Swallow — caller flows shouldn't fail because a cosmetic sync hit a transient DB error.
      // Logged here instead of at every call site.
      const { logger } = await import("../../utils/logger");
      logger.warn({ action: "userRepository.syncIdentityAcrossChats", userId, error: String(err) });
    }
  },

  async clearLeftDate(userId: number, chatId: number): Promise<void> {
    await User.updateOne({ userId, chatId }, { $unset: { leftWithWarningsAt: "" } });
  },

  async markBanned(userId: number, chatId: number, username?: string, name?: string): Promise<IUser> {
    const setFields: Record<string, unknown> = { isBanned: true, wasBanned: true };
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    return await User.findOneAndUpdate(
      { userId, chatId },
      {
        $set: setFields,
        $setOnInsert: { warnings: 0, warningReasons: [] },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  },

  async decrementWarning(userId: number, chatId: number): Promise<IUser | null> {
    const user = await User.findOne({ userId, chatId });
    if (!user) return null;

    user.warnings = Math.max(0, user.warnings - 1);
    if (user.warningReasons.length > 0) user.warningReasons.pop();

    if (user.isBanned && user.warnings < MAX_WARNINGS) {
      user.isBanned = false;
    }

    await user.save();
    return user;
  },
};
