import { Topic } from "../models/Topic";
import { ITopic } from "../../types";

export const topicRepository = {
  async findByChatAndTopic(chatId: number, topicId: number): Promise<ITopic | null> {
    return await Topic.findOne({ chatId, topicId });
  },

  async findAllByChatId(chatId: number): Promise<ITopic[]> {
    return await Topic.find({ chatId });
  },

  async upsert(data: {
    chatId: number;
    topicId: number;
    name: string;
    allowedMsgTypes: string[];
    adminOnly?: boolean;
  }): Promise<ITopic> {
    // Any write through this path is by definition the user saving from the
    // dashboard — mark the topic as user-configured so the filter middleware
    // honours `allowedMsgTypes` instead of falling back to "allow everything".
    const result = await Topic.findOneAndUpdate(
      { chatId: data.chatId, topicId: data.topicId },
      { $set: { ...data, isUserConfigured: true } },
      { upsert: true, returnDocument: "after" }
    );
    return result!;
  },

  /** Update only the topic name (used by forum_topic_created/edited auto-cache). */
  async upsertName(chatId: number, topicId: number, name: string): Promise<void> {
    await Topic.findOneAndUpdate(
      { chatId, topicId },
      {
        $set: { name },
        $setOnInsert: { allowedMsgTypes: [], isUserConfigured: false },
      },
      { upsert: true }
    );
  },

  /**
   * Passive discovery — register a topic the first time we see a message in it,
   * so the dashboard's banned-words / topic-rules dropdowns can list every topic
   * that has had any traffic. Telegram's bot API doesn't expose a topic list, so
   * this is the only way to surface a topic that hasn't had explicit rules saved.
   *
   * Uses $setOnInsert: existing rows (with real names from forum_topic_created or
   * user-saved rules) are never overwritten.
   */
  async recordSeen(chatId: number, topicId: number): Promise<void> {
    await Topic.findOneAndUpdate(
      { chatId, topicId },
      {
        $setOnInsert: {
          name: `Tema #${topicId}`,
          allowedMsgTypes: [],
          isUserConfigured: false,
        },
      },
      { upsert: true }
    );
  },

  /**
   * One-shot startup migration — backfill isUserConfigured on rows created before
   * the field existed. Rows with non-empty allowedMsgTypes were obviously
   * dashboard-saved (we never auto-populated types); rows with empty
   * allowedMsgTypes were auto-discovered and should default to "allow all".
   *
   * Idempotent: only touches rows where the field is missing.
   */
  async backfillIsUserConfigured(): Promise<{ configured: number; unconfigured: number }> {
    const [configuredRes, unconfiguredRes] = await Promise.all([
      Topic.updateMany(
        { isUserConfigured: { $exists: false }, "allowedMsgTypes.0": { $exists: true } },
        { $set: { isUserConfigured: true } }
      ),
      Topic.updateMany(
        { isUserConfigured: { $exists: false }, "allowedMsgTypes.0": { $exists: false } },
        { $set: { isUserConfigured: false } }
      ),
    ]);
    return {
      configured: configuredRes.modifiedCount ?? 0,
      unconfigured: unconfiguredRes.modifiedCount ?? 0,
    };
  },

  async deleteOne(chatId: number, topicId: number): Promise<void> {
    await Topic.deleteOne({ chatId, topicId });
  },

  /** Field-level $set so saving rules and saving the reminder can't clobber each other. */
  async setReminder(
    chatId: number,
    topicId: number,
    reminder: { enabled: boolean; text: string }
  ): Promise<ITopic | null> {
    return await Topic.findOneAndUpdate(
      { chatId, topicId },
      { $set: { "reminder.enabled": reminder.enabled, "reminder.text": reminder.text } },
      { returnDocument: "after" }
    );
  },

  /**
   * Atomically claim the right to post this topic's reminder: the filter is the
   * interval check and the update is the claim, so of N simultaneous messages
   * exactly one wins. Returns the doc *before* the update — we need the outgoing
   * `lastMessageId` to delete it.
   */
  async claimReminderSend(chatId: number, topicId: number, cutoff: Date): Promise<ITopic | null> {
    return await Topic.findOneAndUpdate(
      {
        chatId,
        topicId,
        "reminder.enabled": true,
        $or: [{ "reminder.lastSentAt": null }, { "reminder.lastSentAt": { $lte: cutoff } }],
      },
      { $set: { "reminder.lastSentAt": new Date() } },
      { returnDocument: "before" }
    );
  },

  /** Store the id of the reminder just posted, so the next one can delete it. */
  async recordReminderSent(chatId: number, topicId: number, messageId: number): Promise<void> {
    await Topic.updateOne({ chatId, topicId }, { $set: { "reminder.lastMessageId": messageId } });
  },

  /** Undo a claim whose send failed, so the next message retries immediately. */
  async releaseReminderClaim(chatId: number, topicId: number, previousSentAt: Date | null): Promise<void> {
    await Topic.updateOne({ chatId, topicId }, { $set: { "reminder.lastSentAt": previousSentAt } });
  },
};
