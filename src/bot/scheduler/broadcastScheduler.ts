import { Bot } from "grammy";
import { BotContext, IChannelBroadcast } from "../../types";
import { channelBroadcastRepository } from "../../db/repositories/channelBroadcastRepository";
import { sendBroadcastPost } from "../helpers/sendBroadcastPost";
import { madridNow, nextPost } from "./broadcastDefaults";
import { logger } from "../../utils/logger";

const TICK_MS = 60_000;
// One retry on the next tick (~1 min later, same clock hour); then the slot is
// abandoned and the operator inspects the logs.
const MAX_RETRIES = 1;

let timer: NodeJS.Timeout | null = null;

export function startBroadcastScheduler(bot: Bot<BotContext>): void {
  if (timer) return;
  timer = setInterval(() => void tick(bot), TICK_MS);
}

async function tick(bot: Bot<BotContext>): Promise<void> {
  let configs: IChannelBroadcast[];
  try {
    configs = await channelBroadcastRepository.listAll();
  } catch (err) {
    logger.error({ action: "broadcast.tick_list", error: String(err) });
    return;
  }

  const { hour, slot } = madridNow(new Date());
  for (const cfg of configs) {
    for (const post of cfg.posts) {
      if (!post.enabled || !post.url || !post.hours.includes(hour) || post.lastSentSlot === slot) {
        continue;
      }
      try {
        await sendBroadcastPost(bot, cfg.channelId, post, cfg.button);
        await channelBroadcastRepository.markPostSent(cfg.channelId, post.key, slot);
      } catch (err) {
        const attempts = post.retryAttempts + 1;
        if (attempts > MAX_RETRIES) {
          logger.error({
            action: "broadcast.send_giveup",
            channelId: cfg.channelId,
            post: post.key,
            error: String(err),
          });
        } else {
          logger.warn({
            action: "broadcast.send_retry",
            channelId: cfg.channelId,
            post: post.key,
            attempts,
            error: String(err),
          });
        }
        // Advance on give-up, otherwise bump the retry counter. Wrapped so a DB
        // hiccup here can't escape the tick as an unhandled rejection.
        try {
          if (attempts > MAX_RETRIES) {
            await channelBroadcastRepository.markPostSent(cfg.channelId, post.key, slot);
          } else {
            await channelBroadcastRepository.setPostRetry(cfg.channelId, post.key, attempts);
          }
        } catch (dbErr) {
          logger.error({ action: "broadcast.retry_persist", channelId: cfg.channelId, error: String(dbErr) });
        }
      }
    }
  }
}

/** Immediate send of the next-due post ("Enviar ahora"). Throws on failure. */
export async function broadcastNow(bot: Bot<BotContext>, channelId: number): Promise<void> {
  const cfg = await channelBroadcastRepository.findByChannelId(channelId);
  if (!cfg) throw new Error("not_found");
  const next = nextPost(cfg.posts, new Date());
  if (!next) throw new Error("nothing_to_send");
  const post = cfg.posts.find((p) => p.key === next.key);
  if (!post) throw new Error("nothing_to_send");
  await sendBroadcastPost(bot, channelId, post, cfg.button);
}
