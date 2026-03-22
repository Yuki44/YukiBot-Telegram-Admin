import { Schema, model } from "mongoose";
import { IChat } from "../../types";

const chatSchema = new Schema<IChat>({
  chatId: {
    type: Number,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["topics", "normal"],
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  features: {
    languageDetection: {
      type: Boolean,
      default: false,
    },
    spamDetection: {
      type: Boolean,
      default: false,
    },
    topicFiltering: {
      type: Boolean,
      default: false,
    },
    commands: {
      type: Boolean,
      default: false,
    },
    autoBan: {
      type: Boolean,
      default: false,
    },
  },
});

export const Chat = model<IChat>("Chat", chatSchema);
