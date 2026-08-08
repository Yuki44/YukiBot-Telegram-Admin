import { PipelineStage, Types } from "mongoose";
import { User } from "../models/User";
import { IUser, CsamVerdict } from "../../types";
import { logger } from "../../utils/logger";
import { MAX_WARNINGS, NOT_MEMBER_RECHECK_MS } from "../../config/constants";

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
                    $cond: [{ $gt: [{ $ifNull: ["$warnings", 0] }, 0] }, 1, 0],
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

  /**
   * Every user in a chat, unbounded and unsorted — used by chat migration to
   * copy the full roster. (`listByChatId` caps at 1000 and runs a sort/aggregation
   * pipeline, so it is unsuitable for a complete copy.)
   */
  async findAllByChatId(chatId: number): Promise<IUser[]> {
    return await User.find({ chatId });
  },

  /**
   * Collapse duplicate (userId, chatId) docs into a single record per user. The
   * unique compound index should prevent dupes from being created, but if the
   * index is missing on a deployed DB or was created post-hoc, dupes can survive.
   *
   * Per duplicate group we MERGE state into the winner (max warnings, union
   * reasons, OR(isBanned), OR(wasBanned)) and delete the rest. G3 is preserved
   * since wasBanned can only stay true.
   */
  async deduplicateForChat(chatId: number): Promise<{
    duplicateGroups: number;
    removed: number;
    merged: number;
  }> {
    const groups = await User.aggregate<{ _id: number; ids: Types.ObjectId[]; count: number }>([
      { $match: { chatId } },
      { $group: { _id: "$userId", ids: { $push: "$_id" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);

    let removed = 0;
    let merged = 0;
    for (const g of groups) {
      const docs = await User.find({ _id: { $in: g.ids } });
      if (docs.length < 2) continue;

      // Winner: highest warnings, then banned status, then newest ObjectId.
      const winner = docs.reduce((best, curr) => {
        const bw = best.warnings ?? 0;
        const cw = curr.warnings ?? 0;
        if (cw !== bw) return cw > bw ? curr : best;
        const bb = best.isBanned === true ? 1 : 0;
        const cb = curr.isBanned === true ? 1 : 0;
        if (cb !== bb) return cb > bb ? curr : best;
        return String(curr._id) > String(best._id) ? curr : best;
      });

      const mergedReasons = Array.from(new Set(docs.flatMap((d) => d.warningReasons ?? [])));
      const mergedWarnings = Math.max(...docs.map((d) => d.warnings ?? 0));
      const mergedIsBanned = docs.some((d) => d.isBanned === true);
      const mergedWasBanned = docs.some((d) => d.wasBanned === true) || mergedIsBanned;
      // Prefer a non-empty username/name; fall back to winner's.
      const mergedUsername = docs.find((d) => d.username)?.username ?? winner.username;
      const mergedName = docs.find((d) => d.name)?.name ?? winner.name;

      await User.updateOne(
        { _id: winner._id },
        {
          $set: {
            warnings: mergedWarnings,
            warningReasons: mergedReasons,
            isBanned: mergedIsBanned,
            wasBanned: mergedWasBanned,
            ...(mergedUsername ? { username: mergedUsername } : {}),
            ...(mergedName ? { name: mergedName } : {}),
          },
        }
      );
      merged++;

      const toDelete = docs.filter((d) => String(d._id) !== String(winner._id)).map((d) => d._id);
      if (toDelete.length > 0) {
        const res = await User.deleteMany({ _id: { $in: toDelete } });
        removed += res.deletedCount ?? toDelete.length;
      }
    }

    // Best-effort: make sure the unique index is in place so this can't happen
    // again. syncIndexes is a no-op when indexes already match the schema.
    try {
      await User.syncIndexes();
    } catch {
      // syncIndexes can fail if dupes still exist (shouldn't here, but be safe).
    }

    return { duplicateGroups: groups.length, removed, merged };
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

  /** Persist an identity read from Telegram and mark it trustworthy. Unsets a removed username. */
  async confirmIdentity(userId: number, chatId: number, name?: string, username?: string): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = { identityConfirmedAt: now, lastIdentityCheckAt: now };
    const update: Record<string, unknown> = { $setOnInsert: { userId, chatId } };
    if (name && name.trim()) set.name = name.trim();
    if (username && username.trim()) set.username = username.trim();
    else update.$unset = { username: 1 };
    update.$set = set;
    await User.updateOne({ userId, chatId }, update, { upsert: true, setDefaultsOnInsert: true });
  },

  /** Persist a username-only observation without promoting an unconfirmed name baseline. */
  async updateIdentityUsername(userId: number, chatId: number, username?: string): Promise<void> {
    const now = new Date();
    const update: Record<string, unknown> = {
      $set: { lastIdentityCheckAt: now },
      $setOnInsert: { userId, chatId },
    };
    if (username && username.trim()) (update.$set as Record<string, unknown>).username = username.trim();
    else update.$unset = { username: 1 };
    await User.updateOne({ userId, chatId }, update, { upsert: true, setDefaultsOnInsert: true });
  },

  /** Every row of this user, across all chats. */
  async findAllForUser(userId: number): Promise<IUser[]> {
    return await User.find({ userId });
  },

  async findOrCreate(userId: number, chatId: number, username?: string, name?: string): Promise<IUser> {
    // Identity is seeded here but never overwritten: nameChangeTracker owns updates, and a
    // stale $set (a cached admin name, a months-old join) hid the very next real change.
    const insert: Record<string, unknown> = {
      userId,
      chatId,
      warnings: 0,
      warningReasons: [],
      isBanned: false,
      wasBanned: false,
    };
    if (username) insert.username = username;
    if (name) insert.name = name;

    return await User.findOneAndUpdate(
      { userId, chatId },
      { $setOnInsert: insert },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );
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
   * Propagate the avatar only. Name/@username are per-chat: writing another chat's row would
   * either silence its notice or fabricate one, and enforcement state is chat-scoped too (G3).
   */
  async syncPhotoAcrossChats(
    userId: number,
    fields: {
      photoFileId?: string | null;
      photoCheckedAt?: Date;
    }
  ): Promise<void> {
    const setFields: Record<string, unknown> = {};
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
      logger.warn({ action: "userRepository.syncPhotoAcrossChats", userId, error: String(err) });
    }
  },

  /** Clears the exit markers so a rejoining user re-enters the scan queue as a member. */
  async clearLeftDate(userId: number, chatId: number): Promise<void> {
    await User.updateOne({ userId, chatId }, { $unset: { leftWithWarningsAt: "", notMemberAt: "" } });
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

  /**
   * Candidates for the rolling CSAM bio scan: members of the given chats whose
   * bio has never been checked, or was checked before `staleBefore`. Ordered
   * never-checked first, then oldest-checked, so new joiners are seen quickly
   * and everyone is eventually re-checked. Banned users and rows confirmed to
   * have left the chat are skipped — we only scan who is actually inside.
   *
   * A row benched as absent returns to the queue after `notMemberRecheckBefore`: a rejoin we
   * never saw must not exclude a user from CSAM coverage permanently. Both exit markers get
   * that same window — `leftWithWarningsAt` is a retention rule, not a permanent scan ban.
   */
  async findDueForBioScan(
    chatIds: number[],
    staleBefore: Date,
    limit: number,
    notMemberRecheckBefore: Date = new Date(Date.now() - NOT_MEMBER_RECHECK_MS)
  ): Promise<IUser[]> {
    if (chatIds.length === 0) return [];
    return await User.find({
      chatId: { $in: chatIds },
      isBanned: { $ne: true },
      $and: [
        {
          $or: [{ notMemberAt: { $exists: false } }, { notMemberAt: { $lt: notMemberRecheckBefore } }],
        },
        {
          $or: [
            { leftWithWarningsAt: { $exists: false } },
            { leftWithWarningsAt: { $lt: notMemberRecheckBefore } },
          ],
        },
        {
          $or: [{ lastBioCheckAt: { $exists: false } }, { lastBioCheckAt: { $lt: staleBefore } }],
        },
      ],
    })
      .sort({ lastBioCheckAt: 1 })
      .limit(limit);
  },

  /** Stamp lastBioCheckAt on every chat doc for this user (bio is a global property). */
  async markBioChecked(userId: number, when: Date = new Date()): Promise<void> {
    await User.updateMany({ userId }, { $set: { lastBioCheckAt: when } });
  },

  /** Stamp lastIdentityCheckAt on every chat doc for this user. */
  async markIdentityChecked(userId: number, when: Date = new Date()): Promise<void> {
    await User.updateMany({ userId }, { $set: { lastIdentityCheckAt: when } });
  },

  /**
   * Atomically claim the right to raise a CP_ALERTA (false = already raised inside the window).
   * When the row fails the condition the upsert collides on userId+chatId, and that E11000 is
   * the "already alerted" answer — what makes two concurrent paths yield exactly one alert.
   */
  async claimCsamAlert(
    userId: number,
    chatId: number,
    verdict: CsamVerdict,
    windowMs: number,
    now: Date = new Date()
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - windowMs);
    const free: Record<string, unknown>[] = [
      { csamAlertedAt: { $exists: false } },
      { csamAlertedAt: { $lt: cutoff } },
    ];
    // The action changed, so an escalation must reach the admins even inside the window.
    if (verdict === "AUTO_BAN") free.push({ csamAlertVerdict: "SILENCE" });

    try {
      await User.updateOne(
        { userId, chatId, $or: free },
        { $set: { csamAlertedAt: now, csamAlertVerdict: verdict }, $setOnInsert: { userId, chatId } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      logger.error({ action: "claimCsamAlert", userId, chatId, error: String(err) });
      return true; // never swallow an alert because of a DB hiccup
    }
  },

  /** Undo a claim whose alert never reached anyone, so the next path can still raise it. */
  async releaseCsamAlert(userId: number, chatId: number): Promise<void> {
    try {
      await User.updateOne({ userId, chatId }, { $unset: { csamAlertedAt: 1, csamAlertVerdict: 1 } });
    } catch (err) {
      logger.error({ action: "releaseCsamAlert", userId, chatId, error: String(err) });
    }
  },

  /**
   * Track consecutive getChat failures. The counter drives the scanner's presence probe:
   * a user the peer cache can never resolve is either a lurker or gone, and only
   * getChatMember can tell them apart.
   */
  async recordBioMiss(userId: number, chatId: number): Promise<number> {
    const doc = await User.findOneAndUpdate(
      { userId, chatId },
      { $inc: { bioMissCount: 1 } },
      { returnDocument: "after" }
    );
    return doc?.bioMissCount ?? 0;
  },

  async clearBioMiss(userId: number, chatId: number): Promise<void> {
    await User.updateOne({ userId, chatId }, { $set: { bioMissCount: 0 } });
  },

  /**
   * Atomically reserve a presence probe slot for this row, honoring cooldown.
   * Returns false when still cooling down.
   */
  async claimPresenceProbeSlot(
    userId: number,
    chatId: number,
    cooldownMs: number,
    now: Date = new Date()
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - cooldownMs);
    const res = await User.updateOne(
      {
        userId,
        chatId,
        $or: [{ lastPresenceProbeAt: { $exists: false } }, { lastPresenceProbeAt: { $lt: cutoff } }],
      },
      {
        $set: { lastPresenceProbeAt: now },
        $setOnInsert: { userId, chatId },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return (res.modifiedCount ?? 0) > 0 || (res.upsertedCount ?? 0) > 0;
  },

  /**
   * Apply the exit policy to a row whose absence getChatMember just confirmed, mirroring
   * chatMemberHandler: drop a clean row, keep one that still carries state. Kept rows are
   * stamped notMemberAt so the scan queue skips them until the user rejoins.
   * Returns whether the row was deleted.
   */
  async markNotMember(userId: number, chatId: number): Promise<boolean> {
    const user = await User.findOne({ userId, chatId });
    if (!user) return false;

    const keep = user.wasBanned || user.isBanned || user.warnings > 0;
    if (!keep) {
      await User.deleteOne({ userId, chatId });
      return true;
    }

    const set: Record<string, unknown> = { notMemberAt: new Date() };
    if (user.warnings > 0 && !user.leftWithWarningsAt) set.leftWithWarningsAt = new Date();
    await User.updateOne({ userId, chatId }, { $set: set });
    return false;
  },

  /** Resets the languageDetection grace flag so this user's next offense is a fresh grace notice. */
  async clearLanguageGrace(userId: number, chatId: number): Promise<void> {
    await User.updateOne({ userId, chatId }, { $unset: { languageGraceGivenAt: "" } });
  },
};
