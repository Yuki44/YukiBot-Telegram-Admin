import { Schema, model } from "mongoose";
import { IChannelBroadcast } from "../../types";

const postSchema = new Schema<IChannelBroadcast["posts"][number]>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    caption: { type: String, default: "" },
    url: { type: String, default: "" },
    image: {
      type: {
        data: { type: Buffer, required: true },
        filename: { type: String, required: true },
        contentType: { type: String, required: true },
      },
      default: null,
    },
    hours: { type: [Number], default: [] },
    enabled: { type: Boolean, default: true },
    lastSentSlot: { type: String, default: null },
    retryAttempts: { type: Number, default: 0 },
  },
  { _id: false }
);

const channelBroadcastSchema = new Schema<IChannelBroadcast>({
  channelId: { type: Number, required: true, unique: true },
  channelName: { type: String, default: "" },
  photoFileId: { type: String, default: null },
  photoCheckedAt: { type: Date, default: null },
  button: {
    enabled: { type: Boolean, default: true },
    text: { type: String, default: "👉 Entrar aquí" },
  },
  posts: { type: [postSchema], default: [] },
});

export const ChannelBroadcast = model<IChannelBroadcast>("ChannelBroadcast", channelBroadcastSchema);
