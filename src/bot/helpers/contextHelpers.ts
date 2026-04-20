/**
 * Helpers that extract common data from BotContext.
 */

import { BotContext } from "../../types";
import { LogUser } from "./sendLog";

/** Parse command arguments from ctx.match into a trimmed string array. */
export function parseArgs(ctx: BotContext): string[] {
  return ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];
}

/** Build a LogUser actor object from ctx.from, or undefined if absent. */
export function buildActor(ctx: BotContext): LogUser | undefined {
  if (!ctx.from) return undefined;
  const fullName = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : "");
  return { id: ctx.from.id, name: fullName, username: ctx.from.username };
}

/** Extract the chat title safely (avoids `as any` casts). */
export function getChatTitle(ctx: BotContext): string {
  const chat = ctx.chat;
  if (!chat) return "Unknown";
  if ("title" in chat && chat.title) return chat.title;
  return "Unknown";
}
