import { MessageType } from "../types";

export const BOT_ENABLED = process.env.BOT_ENABLED !== "false";

// Parse ADMIN_IDS from comma-separated string
// Example: ADMIN_IDS=7669001456,615291982,2988220074,6259545160
// These users get super-admin access to the web dashboard (see all chats).
export const ADMIN_IDS: number[] = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id)
      .map(Number)
  : [];

export const PORT = Number(process.env.PORT ?? 3000);

// Bot username (without @) — used by the web dashboard's Telegram Login Widget.
// Required for the widget to render. Register the deploy domain in BotFather via /setdomain.
export const BOT_USERNAME = process.env.BOT_USERNAME ?? "";

// JWT signing secret for the web dashboard. 32+ chars recommended.
// Required at startup if the API server is enabled.
export const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Parse TOPIC_RULES from JSON string
// Example: TOPIC_RULES={"4":["photo","video"],"2":["video"]}
export const TOPIC_RULES: Record<number, MessageType[]> = (() => {
  if (!process.env.TOPIC_RULES) {
    return {};
  }

  try {
    const parsed = JSON.parse(process.env.TOPIC_RULES);
    const rules: Record<number, MessageType[]> = {};

    for (const [topicId, types] of Object.entries(parsed)) {
      const messageTypes = (types as string[]).map((type) => {
        const normalized = type.toLowerCase();
        return MessageType[
          (normalized.charAt(0).toUpperCase() + normalized.slice(1)) as keyof typeof MessageType
        ];
      });
      rules[Number(topicId)] = messageTypes;
    }

    return rules;
  } catch {
    // Cannot use logger here because this runs at module load time before logger may be initialized
    return {};
  }
})();
