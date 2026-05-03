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
          _sortName: { $ifNull: ["$name", { $ifNull: ["$username", ""] }] },
        },
      },
      { $sort: { _statusTier: 1, _sortName: 1 } },
      { $limit: limit },
      { $project: { _statusTier: 0, _sortName: 0 } },
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
