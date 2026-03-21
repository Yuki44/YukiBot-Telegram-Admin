import { Schema, model } from "mongoose";
import { IMessage } from "../../types";

const messageSchema = new Schema<IMessage>({
  userId: {
    type: Number,
    required: true,
  },
  chatId: {
    type: Number,
    required: true,
  },
  fingerprint: {
    type: String,
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export const Message = model<IMessage>("Message", messageSchema);
