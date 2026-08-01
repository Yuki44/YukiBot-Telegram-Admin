import { Schema, model } from "mongoose";
import { ITopic } from "../../types";

const topicSchema = new Schema<ITopic>({
  chatId: {
    type: Number,
    required: true,
  },
  topicId: {
    type: Number,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  allowedMsgTypes: {
    type: [String],
    required: true,
  },
  adminOnly: {
    type: Boolean,
    default: false,
  },
  isUserConfigured: {
    type: Boolean,
    default: false,
  },
  missingStrikes: {
    type: Number,
    default: 0,
  },
  typesVersion: {
    type: Number,
    default: 0,
  },
  reminder: {
    enabled: { type: Boolean, default: false },
    text: { type: String, default: "" },
    lastSentAt: { type: Date, default: null },
    lastMessageId: { type: Number, default: null },
  },
});

// Compound unique index on chatId + topicId
topicSchema.index({ chatId: 1, topicId: 1 }, { unique: true });

export const Topic = model<ITopic>("Topic", topicSchema);
