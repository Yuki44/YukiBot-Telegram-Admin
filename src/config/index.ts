import { MessageType } from "../types";

export const TOPIC_RULES: Record<number, MessageType[]> = {
  12283: [MessageType.Photo, MessageType.Video],
  4: [MessageType.Video],
};

// TODO: populate with admin user IDs
export const ADMIN_IDS: number[] = [];
