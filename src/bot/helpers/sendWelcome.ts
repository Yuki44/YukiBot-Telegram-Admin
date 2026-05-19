import { Api } from "grammy";
import { IChat } from "../../types";
import { esc } from "./html";
import { logger } from "../../utils/logger";

export type WelcomeConfig = NonNullable<IChat["welcome"]>;

export interface WelcomeUser {
  id: number;
  username?: string;
  name: string;
}

// The two literal tokens an admin can put in the welcome message. Kept as a
// capturing group so String.split keeps the delimiters in the result.
const TOKEN_RE = /(<@username>|<chat name>)/g;

/**
 * Render the admin-configured template. We split on the tokens *before*
 * escaping, then escape only the plain-text segments — so admin-entered
 * `<`/`>`/`&` can't break the HTML, while the generated mention/title stay
 * intact. Per D1: with a @username we emit `@username` (Telegram auto-links
 * it); without one we emit the plain escaped name and never a link.
 */
export function renderWelcome(template: string, user: WelcomeUser, chatTitle: string): string {
  const usernameRepl = user.username ? `@${user.username}` : esc(user.name);
  const chatRepl = esc(chatTitle);

  return template
    .split(TOKEN_RE)
    .map((part) => {
      if (part === "<@username>") return usernameRepl;
      if (part === "<chat name>") return chatRepl;
      return esc(part);
    })
    .join("");
}

/**
 * Send the welcome message to the group. Returns true on success; on failure
 * it logs (structured logger, never to the chat — G10/G11) and returns false
 * so the caller can release its claim and let a later join retry.
 */
export async function sendWelcome(
  api: Api,
  chatId: number,
  welcome: WelcomeConfig,
  user: WelcomeUser,
  chatTitle: string
): Promise<boolean> {
  try {
    const text = renderWelcome(welcome.message, user, chatTitle);
    const btn = welcome.button;
    const reply_markup =
      btn?.enabled && btn.text.trim().length > 0 && btn.url.trim().length > 0
        ? { inline_keyboard: [[{ text: btn.text, url: btn.url }]] }
        : undefined;

    await api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup });
    return true;
  } catch (err) {
    logger.error({ action: "sendWelcome", chatId, userId: user.id, error: String(err) });
    return false;
  }
}
