import { useEffect, useState } from "react";
import { ApiError, api } from "./api";
import type { ChatDetail } from "../types/api";

const cache = new Map<string, ChatDetail>();
const inflight = new Map<string, Promise<ChatDetail>>();

/**
 * Tiny module-level cache so sub-screens (Topics, Users, Features, …) can show the chat
 * name in their AppBar without re-fetching `GET /api/chats/:chatId` on every navigation.
 *
 * The cache is process-lifetime — a hard refresh re-fetches. That's fine: chat name and
 * type don't change often, and stale features get refreshed when the user opens the
 * Features screen which fetches fresh chat detail anyway.
 */
export function useChat(chatId: string | undefined): ChatDetail | null {
  const key = chatId ?? "";
  const [chat, setChat] = useState<ChatDetail | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!chatId) return;
    const cached = cache.get(key);
    if (cached) {
      setChat(cached);
      return;
    }
    let cancelled = false;
    let p = inflight.get(key);
    if (!p) {
      p = api.chats.get(chatId);
      inflight.set(key, p);
    }
    p.then(
      (c) => {
        cache.set(key, c);
        inflight.delete(key);
        if (!cancelled) setChat(c);
      },
      (err) => {
        inflight.delete(key);
        if (err instanceof ApiError && err.status === 401) {
          // ProtectedRoute or other layers will handle redirect; just don't crash here.
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [chatId, key]);

  return chat;
}

/** Invalidate the cache for a chat (e.g. after editing features). */
export function invalidateChat(chatId: string | number): void {
  cache.delete(String(chatId));
}
