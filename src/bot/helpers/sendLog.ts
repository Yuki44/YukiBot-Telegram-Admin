import { Api } from "grammy";
import { Message } from "grammy/types";
import { IChat } from "../../types";
import { esc } from "./html";
import { forwardToLog } from "./forwardToLog";
import { logger } from "../../utils/logger";

// ── Types ────────────────────────────────────────────────────────────

export type LogAction =
  | "AVISO"
  | "SILENCIO"
  | "BAN"
  | "AUTO_BAN"
  | "KICK"
  | "Q_BAN"
  | "Q_SILENCIO"
  | "Q_AVISO"
  | "ENTRADA_USUARIO"
  | "SALIDA_USUARIO";

export interface LogUser {
  id: number;
  name: string;
  username?: string;
}

export interface LogPayload {
  action: LogAction;
  actor?: LogUser;
  target: LogUser;
  chatId: number;
  chatName: string;
  chatType: "topics" | "normal";
  warnings?: number;
  reason?: string;
  muteUntil?: Date;
  /** Inviter / link creator for ENTRADA_USUARIO */
  inviter?: LogUser;
  /** Topic context (topics-type chats only) */
  topicId?: number;
  /** Explicit topic name — skips DB lookup when provided */
  topicName?: string;
  /** Specific message ID to link to in the nav line (e.g. the message the command was used on) */
  refMsgId?: number;
  /** The original message the admin replied to — forwarded via forwardToLog */
  repliedMsg?: Message;
}

// ── Flag mapping ─────────────────────────────────────────────────────

const FLAG_MAP: Record<LogAction, keyof IChat["logFlags"]> = {
  AVISO: "logWarns",
  SILENCIO: "logSilences",
  BAN: "logBans",
  AUTO_BAN: "logAutoRebans",
  KICK: "logKicks",
  Q_BAN: "logQBans",
  Q_SILENCIO: "logUnsilences",
  Q_AVISO: "logUnwarns",
  ENTRADA_USUARIO: "logEntries",
  SALIDA_USUARIO: "logExits",
};

const EMOJI_MAP: Record<LogAction, string> = {
  AVISO: "⚠️",
  SILENCIO: "🔇",
  BAN: "🚷",
  AUTO_BAN: "🔄",
  KICK: "❗️",
  Q_BAN: "🕊️",
  Q_SILENCIO: "🔊",
  Q_AVISO: "✅",
  ENTRADA_USUARIO: "➕",
  SALIDA_USUARIO: "➖",
};

// ── Helpers ──────────────────────────────────────────────────────────

function userLink(u: LogUser): string {
  return `<a href="tg://user?id=${u.id}">${esc(u.name)}</a> [<code>${u.id}</code>]`;
}

function chatIdForLink(chatId: number): string {
  return String(chatId).replace(/^-100/, "");
}

function topicLink(chatId: number, topicId: number, topicName: string): string {
  const cid = chatIdForLink(chatId);
  return `<a href="https://t.me/c/${cid}/${topicId}">${esc(topicName)}</a>`;
}

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function formatDate(d: Date): string {
  const day = d.getDate();
  const month = MESES_ES[d.getMonth()];
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day} de ${monthCap} ${year} a las ${hh}:${mm}:${ss}`;
}

function formatShortDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function hashIds(target: LogUser, actor?: LogUser): string {
  let tags = `#id${target.id}`;
  if (actor && actor.id !== target.id) tags += ` #id${actor.id}`;
  return tags;
}

/**
 * Builds the navigation line for a log entry.
 * - refMsgId present → link to that exact message
 * - topics + topicId → "ir al tema"
 * - topics, no topicId (General) → "ir al grupo" at message 1
 * - normal → "ir al grupo" at a high ID so Telegram lands near latest messages
 */
function buildNavLine(
  chatId: number,
  chatType: "topics" | "normal",
  topicId?: number,
  refMsgId?: number
): string {
  const cid = chatIdForLink(chatId);
  if (refMsgId) {
    const isTopicContext = chatType === "topics" && topicId;
    return `• ${isTopicContext ? "Tema" : "Grupo"}: <a href="https://t.me/c/${cid}/${refMsgId}">⬅️ ir al ${isTopicContext ? "tema" : "grupo"}</a>`;
  }
  if (chatType === "topics" && topicId) {
    return `• Tema: ${topicLink(chatId, topicId, "⬅️ ir al tema")}`;
  }
  if (chatType === "topics") {
    return `• Grupo: <a href="https://t.me/c/${cid}/1">⬅️ ir al grupo</a>`;
  }
  return `• Grupo: <a href="https://t.me/c/${cid}/999999999">⬅️ ir al grupo</a>`;
}

// ── Main ─────────────────────────────────────────────────────────────

export async function sendLog(
  api: Api,
  chatConfig: IChat | null | undefined,
  payload: LogPayload
): Promise<void> {
  try {
    if (!chatConfig?.logsTo) return;

    const flag = FLAG_MAP[payload.action];
    if (!chatConfig.logFlags?.[flag]) return;

    const emoji = EMOJI_MAP[payload.action];
    const now = new Date();
    const grupo = `${esc(payload.chatName)} [<code>${payload.chatId}</code>]`;
    const fecha = formatDate(now);
    const navLine = buildNavLine(payload.chatId, payload.chatType, payload.topicId, payload.refMsgId);

    let lines: string[] = [];

    switch (payload.action) {
      case "AVISO": {
        lines = [
          `${emoji} #AVISO`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Avisos: ${payload.warnings ?? "?"}/3`,
        ];
        if (payload.reason) lines.push(`• Razón: ${esc(payload.reason)}`);
        lines.push(`• Fecha: ${fecha}`);
        lines.push(hashIds(payload.target, payload.actor));
        break;
      }

      case "SILENCIO": {
        const until = payload.muteUntil ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const untilStr = formatShortDate(until);
        lines = [
          `${emoji} #SILENCIO`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Duración: 1 semana hasta el ${untilStr}`,
          `• Fecha: ${fecha}`,
          hashIds(payload.target, payload.actor),
        ];
        break;
      }

      case "BAN": {
        lines = [
          `${emoji} #BAN`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
        ];
        if (payload.reason) lines.push(`• Razón: ${esc(payload.reason)}`);
        lines.push(`• Fecha: ${fecha}`);
        lines.push(hashIds(payload.target, payload.actor));
        break;
      }

      case "AUTO_BAN": {
        lines = [
          `${emoji} #AUTO_BAN`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Fecha: ${fecha}`,
          hashIds(payload.target),
        ];
        break;
      }

      case "KICK": {
        lines = [
          `${emoji} #KICK`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Fecha: ${fecha}`,
          hashIds(payload.target, payload.actor),
        ];
        break;
      }

      case "Q_BAN": {
        lines = [
          `${emoji} #Q_BAN`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Fecha: ${fecha}`,
          hashIds(payload.target, payload.actor),
        ];
        break;
      }

      case "Q_AVISO": {
        lines = [
          `${emoji} #Q_AVISO`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Avisos: ${payload.warnings ?? 0}/3`,
          `• Fecha: ${fecha}`,
          hashIds(payload.target, payload.actor),
        ];
        break;
      }

      case "Q_SILENCIO": {
        lines = [
          `${emoji} #Q_SILENCIO`,
          `• De: ${payload.actor ? userLink(payload.actor) : "Sistema"}`,
          `• A: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Fecha: ${fecha}`,
          hashIds(payload.target, payload.actor),
        ];
        break;
      }

      case "ENTRADA_USUARIO": {
        lines = [`${emoji} #ENTRADA_USUARIO`, `• De: ${userLink(payload.target)}`];
        if (payload.actor && payload.actor.id !== payload.target.id) {
          lines.push(`• Aprobado por: ${userLink(payload.actor)}`);
        }
        lines.push(`• Grupo: ${grupo}`);
        lines.push(navLine);
        if (payload.inviter) {
          lines.push(`• Enlace de: ${userLink(payload.inviter)}`);
        }
        lines.push(`• Fecha: ${fecha}`);
        const entryIds = [payload.target, payload.actor, payload.inviter]
          .filter((u): u is LogUser => !!u)
          .reduce<number[]>((acc, u) => {
            if (!acc.includes(u.id)) acc.push(u.id);
            return acc;
          }, []);
        lines.push(entryIds.map((id) => `#id${id}`).join(" "));
        break;
      }

      case "SALIDA_USUARIO": {
        lines = [
          `${emoji} #SALIDA_USUARIO`,
          `• De: ${userLink(payload.target)}`,
          `• Grupo: ${grupo}`,
          navLine,
          `• Fecha: ${fecha}`,
          hashIds(payload.target),
        ];
        break;
      }
    }

    const text = lines.join("\n");
    await api.sendMessage(chatConfig.logsTo, text, { parse_mode: "HTML" });

    if (payload.repliedMsg) {
      await forwardToLog(api, chatConfig.logsTo, payload.repliedMsg);
    }
  } catch (err) {
    logger.error({ action: "sendLog", logAction: payload.action, error: String(err) });
  }
}
