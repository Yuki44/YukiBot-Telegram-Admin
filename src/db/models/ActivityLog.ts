import { Schema, model } from "mongoose";
import { IActivityLog } from "../../types";

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const schema = new Schema<IActivityLog>({
  chatId: { type: Number, required: true },
  type: {
    type: String,
    enum: [
      "warn",
      "unwarn",
      "silence",
      "unsilence",
      "ban",
      "unban",
      "kick",
      "autoban",
      "pardon",
      "feature_toggle",
      "topic_rule_change",
      "whitelist_add",
      "whitelist_remove",
      "combo_add",
      "combo_remove",
      "banned_word_add",
      "banned_word_remove",
    ],
    required: true,
  },
  source: { type: String, enum: ["bot", "panel", "auto"], required: true },
  actorId: { type: Number, required: true },
  actorName: { type: String },
  actorUsername: { type: String },
  targetId: { type: Number },
  targetName: { type: String },
  targetUsername: { type: String },
  targetRef: { type: String },
  reason: { type: String },
  topicId: { type: Number },
  warningsAfter: { type: Number },
  messageText: { type: String, maxlength: 500 },
  timestamp: { type: Date, default: () => new Date(), required: true },
});

// TTL — auto-delete entries older than 90 days.
schema.index({ timestamp: 1 }, { expireAfterSeconds: TTL_SECONDS });

// Primary access pattern: most-recent first per chat, optionally filtered by type.
schema.index({ chatId: 1, timestamp: -1 });
schema.index({ chatId: 1, type: 1, timestamp: -1 });

export const ActivityLog = model<IActivityLog>("ActivityLog", schema);
