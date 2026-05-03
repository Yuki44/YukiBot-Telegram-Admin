import { Schema, model } from "mongoose";
import { IBannedWord } from "../../types";

const schema = new Schema<IBannedWord>({
  chatId: { type: Number, required: true },
  word: { type: String, required: true, lowercase: true, trim: true },
  severity: {
    type: String,
    enum: ["flag", "aviso", "borrar", "silenciar", "kick"],
    required: true,
  },
  exactMatch: { type: Boolean, default: false },
  scope: { type: String, enum: ["all", "topic"], required: true },
  topicId: { type: Number },
  createdBy: { type: Number, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

// Prevent duplicate rules for the same word + scope (within a topic if topic-scoped).
schema.index(
  { chatId: 1, word: 1, scope: 1, topicId: 1 },
  { unique: true, partialFilterExpression: { word: { $exists: true } } }
);

export const BannedWord = model<IBannedWord>("BannedWord", schema);
