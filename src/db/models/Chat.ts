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
  whitelist: {
    type: Boolean,
    default: false,
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
  forwardsTo: {
    type: Number,
    required: false,
    default: null,
  },
  logsTo: {
    type: Number,
    required: false,
    default: null,
  },
  logFlags: {
    logWarns: { type: Boolean, default: false },
    logSilences: { type: Boolean, default: false },
    logBans: { type: Boolean, default: false },
    logAutoRebans: { type: Boolean, default: false },
    logKicks: { type: Boolean, default: false },
    logQBans: { type: Boolean, default: false },
    logUnsilences: { type: Boolean, default: false },
    logUnwarns: { type: Boolean, default: false },
    logEntries: { type: Boolean, default: false },
    logExits: { type: Boolean, default: false },
  },
});

export const Chat = model<IChat>("Chat", chatSchema);
