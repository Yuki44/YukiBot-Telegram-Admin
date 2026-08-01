import { Bot, GrammyError } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { topicRepository } from "../../db/repositories/topicRepository";
import { bannedWordRepository } from "../../db/repositories/bannedWordRepository";
import { isPlaceholderTopicName } from "../../utils/topicName";
import { logger } from "../../utils/logger";
import { TOPIC_SWEEP_INTERVAL_MS, TOPIC_SWEEP_SPACING_MS, TOPIC_SWEEP_STRIKES } from "../../config/constants";

/**
 * Telegram never notifies bots that a forum topic was deleted (no
 * `forum_topic_deleted` update exists), so stale rows can only be found by probing.
 *
 * The probe is `editForumTopic` with the topic's *own* cached name, verified
 * against production:
 *   deleted / never existed → 400 TOPIC_ID_INVALID
 *   alive                   → 400 TOPIC_NOT_MODIFIED (nothing mutated)
 * `sendChatAction` and a field-less `editForumTopic` both return ok for
 * nonexistent threads, so neither can serve as a probe.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const DELETED_ERROR = "TOPIC_ID_INVALID";

export type ProbeVerdict = "alive" | "deleted" | "renamed";

/** Only the exact deletion signal may lead to a delete; anything else means alive. */
export function classifyProbe(ok: boolean, error: unknown): ProbeVerdict {
  if (ok) return "renamed";
  if (error instanceof GrammyError && error.description.includes(DELETED_ERROR)) return "deleted";
  return "alive";
}

async function probeTopic(
  bot: Bot<BotContext>,
  chatId: number,
  topicId: number,
  name: string
): Promise<ProbeVerdict> {
  try {
    await bot.api.editForumTopic(chatId, topicId, { name });
    return classifyProbe(true, null);
  } catch (err) {
    return classifyProbe(false, err);
  }
}

async function purgeTopic(chatId: number, topicId: number, name: string): Promise<void> {
  const words = await bannedWordRepository.removeByTopic(chatId, topicId);
  await topicRepository.deleteOne(chatId, topicId);
  logger.info({ action: "topicSweep.deleted", chatId, topicId, name, bannedWordsRemoved: words });
}

async function sweepChat(bot: Bot<BotContext>, chatId: number): Promise<void> {
  const info = await bot.api.getChat(chatId);
  if (!("is_forum" in info) || !info.is_forum) {
    logger.warn({ action: "topicSweep.notForum", chatId });
    return;
  }

  const topics = await topicRepository.findAllByChatId(chatId);
  // A placeholder name isn't the real one, so Telegram would accept the rename
  // and retitle a live topic to "Tema #N".
  const probable = topics.filter((t) => !isPlaceholderTopicName(t.name, t.topicId));

  const verdicts: ProbeVerdict[] = [];
  for (const topic of probable) {
    verdicts.push(await probeTopic(bot, chatId, topic.topicId, topic.name));
    await sleep(TOPIC_SWEEP_SPACING_MS);
  }

  // Demotion, a lost permission or forum mode turning off fails every probe at
  // once — a chat-level fault, never proof that each topic was deleted.
  if (probable.length > 0 && verdicts.every((v) => v === "deleted")) {
    logger.error({ action: "topicSweep.allFailed", chatId, topics: probable.length });
    return;
  }

  for (let i = 0; i < probable.length; i++) {
    const topic = probable[i];
    const verdict = verdicts[i];

    if (verdict === "renamed") {
      logger.error({
        action: "topicSweep.staleNameApplied",
        chatId,
        topicId: topic.topicId,
        name: topic.name,
      });
      continue;
    }

    if (verdict === "alive") {
      await topicRepository.clearMissing(chatId, topic.topicId);
      continue;
    }

    const strikes = await topicRepository.recordMissing(chatId, topic.topicId);
    if (strikes >= TOPIC_SWEEP_STRIKES) {
      await purgeTopic(chatId, topic.topicId, topic.name);
    } else {
      logger.info({ action: "topicSweep.strike", chatId, topicId: topic.topicId, strikes });
    }
  }
}

export async function runTopicSweep(bot: Bot<BotContext>): Promise<void> {
  const chats = await chatRepository.listAll();
  for (const chat of chats) {
    if (chat.type !== "topics" || !chat.isActive) continue;
    try {
      await sweepChat(bot, chat.chatId);
    } catch (err) {
      logger.error({ action: "topicSweep.chat", chatId: chat.chatId, error: String(err) });
    }
  }
}

export function startTopicSweep(bot: Bot<BotContext>): void {
  const tick = (): void => {
    runTopicSweep(bot).catch((err) => logger.error({ action: "topicSweep", error: String(err) }));
  };
  tick();
  setInterval(tick, TOPIC_SWEEP_INTERVAL_MS);
}
