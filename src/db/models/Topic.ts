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
});

// Compound unique index on chatId + topicId
topicSchema.index({ chatId: 1, topicId: 1 }, { unique: true });

export const Topic = model<ITopic>("Topic", topicSchema);
