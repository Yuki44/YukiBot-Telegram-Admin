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
export const BOT_USERNAME = (process.env.BOT_USERNAME ?? "").trim().replace(/^@/, "");

// Hostname registered with BotFather via /setdomain (e.g. "yukibot.dev").
// The dashboard only renders the Telegram Login Widget when window.location.hostname
// matches this — that way local/ngrok hosts hide the widget instead of showing the
// "Bot domain invalid" placeholder. Leave empty to disable the widget everywhere.
// Normalize defensively: trim whitespace, drop scheme + paths + trailing dots/slashes,
// lowercase. An env value like " https://YukiBot.dev/ " becomes "yukibot.dev".
export const BOT_LOGIN_DOMAIN = (process.env.BOT_LOGIN_DOMAIN ?? "")
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .replace(/\.+$/, "");

// JWT signing secret for the web dashboard. 32+ chars recommended.
// Required at startup if the API server is enabled.
export const JWT_SECRET = process.env.JWT_SECRET ?? "";

// Comma-separated watched handles that seed the CSAM/impostor detector
// (e.g. CSAM_WATCH_HANDLES=baduser1,baduser2). Kept in config — NOT source — to honour
// G2 (no hardcoded identifiers). Leading "@" is stripped and values are lowercased.
export const CSAM_WATCH_HANDLES: string[] = process.env.CSAM_WATCH_HANDLES
  ? process.env.CSAM_WATCH_HANDLES.split(",")
      .map((h) => h.trim().replace(/^@/, "").toLowerCase())
      .filter((h) => h)
  : [];

// Anthropic API key for languageDetection Stage 2 classification (console.anthropic.com —
// a separate account/billing from any claude.ai subscription). Required only once the
// languageDetection feature flag is enabled for at least one chat.
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

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
