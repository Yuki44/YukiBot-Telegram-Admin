import { MessageType } from "../types";

export const BOT_ENABLED = process.env.BOT_ENABLED !== "false";

export const TOPIC_RULES: Record<number, MessageType[]> = {
  4: [MessageType.Photo, MessageType.Video],
  2: [MessageType.Video],
};

export const ADMIN_IDS: number[] = [
  process.env.ADMIN_ID_SANTI,
  process.env.ADMIN_ID_EDUARD,
  process.env.ADMIN_ID_YUKI,
  process.env.ADMIN_ID_EL_BARTO,
]
  .filter((id): id is string => !!id)
  .map(Number);

