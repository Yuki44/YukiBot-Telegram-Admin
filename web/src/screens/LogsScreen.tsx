import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { LogUndoSheet } from "../components/LogUndoSheet";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { useScrollRestore } from "../lib/useScrollRestore";
import { timeAgo } from "../lib/utils";
import { isUndoableLogType } from "../types/api";
import type { ActivityLogEntry, ActivityLogType } from "../types/api";

interface FilterDef {
  id: string;
  label: string;
  types: ActivityLogType[]; // empty = all
  tone: "" | "warn" | "info" | "danger" | "brand";
}

const FILTERS: FilterDef[] = [
  { id: "todo", label: "Todo", types: [], tone: "" },
  { id: "warn", label: "Avisos", types: ["warn", "unwarn"], tone: "warn" },
  { id: "silence", label: "Silencios", types: ["silence", "unsilence"], tone: "info" },
  { id: "ban", label: "Bans", types: ["ban", "unban", "autoban", "pardon"], tone: "danger" },
  { id: "kicks", label: "Kicks", types: ["kick"], tone: "danger" },
  { id: "config", label: "Config", types: ["feature_toggle", "topic_rule_change"], tone: "brand" },
  {
    id: "lists",
    label: "Palabras",
    types: [
      "whitelist_add",
      "whitelist_remove",
      "combo_add",
      "combo_remove",
      "banned_word_add",
      "banned_word_remove",
    ],
    tone: "brand",
  },
];

interface TypeMeta {
  icon: () => ReactNode;
  bg: string;
  fg: string;
  label: string;
}

function metaFor(type: ActivityLogType): TypeMeta {
  switch (type) {
    case "warn":
      return { icon: () => I.alert({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Aviso" };
    case "unwarn":
      return { icon: () => I.refresh({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Quitar aviso" };
    case "silence":
      return { icon: () => I.silence({ size: 14 }), bg: "var(--info-bg)", fg: "var(--info-fg)", label: "Silencio" };
    case "unsilence":
      return { icon: () => I.silence({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Quitar silencio" };
    case "ban":
      return { icon: () => I.ban({ size: 14 }), bg: "var(--danger-bg)", fg: "var(--danger-fg)", label: "Ban" };
    case "unban":
      return { icon: () => I.check({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Quitar ban" };
    case "autoban":
      return { icon: () => I.ban({ size: 14 }), bg: "var(--danger-bg)", fg: "var(--danger-fg)", label: "Auto-ban" };
    case "kick":
      return { icon: () => I.logout({ size: 14 }), bg: "var(--danger-bg)", fg: "var(--danger-fg)", label: "Kick" };
    case "pardon":
      return { icon: () => I.check({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Perdón" };
    case "feature_toggle":
      return { icon: () => I.toggle({ size: 14 }), bg: "var(--brand-50)", fg: "var(--brand-700)", label: "Función" };
    case "topic_rule_change":
      return { icon: () => I.hash({ size: 14 }), bg: "var(--brand-50)", fg: "var(--brand-700)", label: "Regla de tema" };
    case "whitelist_add":
      return { icon: () => I.shield({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Permitido añadido" };
    case "whitelist_remove":
      return { icon: () => I.shield({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Permitido quitado" };
    case "combo_add":
      return { icon: () => I.shield({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Permiso mixto añadido" };
    case "combo_remove":
      return { icon: () => I.shield({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Permiso mixto quitado" };
    case "banned_word_add":
      return { icon: () => I.word({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Palabra añadida" };
    case "banned_word_remove":
      return { icon: () => I.word({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Palabra quitada" };
    case "owner_delegate":
      return { icon: () => I.star({ size: 14 }), bg: "var(--brand-50)", fg: "var(--brand-700)", label: "Delegación de propietario" };
    case "owner_revoke":
      return { icon: () => I.star({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Delegación revocada" };
    case "spam_confirmed":
      return { icon: () => I.shield({ size: 14 }), bg: "var(--info-bg)", fg: "var(--info-fg)", label: "Spam confirmado" };
  }
}

function targetLabel(log: ActivityLogEntry): string {
  if (log.targetName?.trim()) return log.targetName;
  if (log.targetUsername?.trim()) return `@${log.targetUsername.replace(/^@/, "")}`;
  if (log.targetId !== null && log.targetId !== undefined) return `ID ${log.targetId}`;
  if (log.targetRef) return log.targetRef;
  return "—";
}

function actorLabel(log: ActivityLogEntry): string {
  if (log.actorName?.trim()) return log.actorName;
  if (log.actorUsername?.trim()) return `@${log.actorUsername.replace(/^@/, "")}`;
  return `ID ${log.actorId}`;
}

function dayKey(ts: string): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

interface LogRowProps {
  log: ActivityLogEntry;
  /** Only forum-type chats have temas — hide the tema line for normal groups. */
  showTopic: boolean;
  onOpenUser?: () => void;
  onUndo?: () => void;
}

function LogRow({ log, showTopic, onOpenUser, onUndo }: LogRowProps) {
  const cfg = metaFor(log.type);
  const target = targetLabel(log);
  const actor = actorLabel(log);
  const isUserTarget = log.targetId !== null;
  const canUndo = !!onUndo && !log.undoneAt && isUndoableLogType(log.type);

  return (
    <div className="yk-row" style={{ alignItems: "flex-start", cursor: "default" }}>
      <div
        className="yk-row-icon"
        style={{ background: cfg.bg, color: cfg.fg, marginTop: 2, flexShrink: 0 }}
      >
        {cfg.icon()}
      </div>
      <div className="yk-row-body">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>{cfg.label}</span>
            <span style={{ color: "var(--ink-500)", fontWeight: 500 }}> · </span>
            {isUserTarget && onOpenUser ? (
              <button
                type="button"
                onClick={onOpenUser}
                className="yk-mono"
                style={{
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  padding: 0,
                  color: "var(--brand-700)",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                }}
              >
                {target}
              </button>
            ) : (
              <span
                className="yk-mono"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
              >
                {target}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-400)",
              fontFamily: "'JetBrains Mono', monospace",
              flexShrink: 0,
            }}
          >
            {timeAgo(log.timestamp)}
          </div>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}>
          {log.reason && <span>{log.reason}</span>}
          {log.reason && log.warningsAfter !== null && <span> · </span>}
          {log.warningsAfter !== null && <span>ahora {log.warningsAfter}/3</span>}
          {showTopic && log.topicId !== null && <span> · tema #{log.topicId}</span>}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-500)" }}>
          por <b style={{ color: "var(--ink-700)" }}>{actor}</b>
          <span style={{ color: "var(--ink-400)" }}> · {log.source === "panel" ? "desde panel" : log.source === "auto" ? "automático" : "desde Telegram"}</span>
        </div>
        {log.messageText && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 10,
              background: "var(--bg-sunken)",
              fontSize: 13,
              color: "var(--ink-700)",
              borderLeft: "3px solid var(--ink-200)",
              whiteSpace: "normal",
            }}
          >
            “{log.messageText}”
          </div>
        )}
        {(canUndo || log.undoneAt) && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {canUndo && (
              <button
                type="button"
                onClick={onUndo}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--ink-100)",
                  background: "var(--bg-card)",
                  color: "var(--ink-700)",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {I.refresh({ size: 14 })}
                Deshacer
              </button>
            )}
            {log.undoneAt && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  fontStyle: "italic",
                }}
              >
                deshecho {timeAgo(log.undoneAt)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LogsScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const chat = useChat(chatId);
  // Initial filter comes from ?filter= so dashboard stat cards can deep-link.
  const initialFilter = searchParams.get("filter");
  const [filter, setFilter] = useState<string>(
    initialFilter && FILTERS.some((f) => f.id === initialFilter) ? initialFilter : "todo"
  );
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<ActivityLogEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useScrollRestore(scrollRef, `logs:${chatId ?? "_"}:${filter}:${q.trim()}`, entries !== null);

  const filterDef = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];

  // Reload when filter or query changes (debounced for q).
  useEffect(() => {
    if (!chatId) return;
    setEntries(null);
    setNextBefore(null);
    setError(null);
    const handle = setTimeout(() => {
      api.logs
        .list(chatId, {
          types: filterDef.types.length > 0 ? filterDef.types : undefined,
          q: q.trim() || undefined,
          limit: 50,
        })
        .then((page) => {
          setEntries(page.entries);
          setNextBefore(page.nextBefore);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            clearSession();
            navigate("/login", { replace: true });
            return;
          }
          setError(err instanceof Error ? err.message : "error");
        });
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, filter, q]);

  async function performUndo(log: ActivityLogEntry) {
    if (!chatId) return;
    await api.logs.undo(chatId, log.id);
    // Reflect the new state without a full re-fetch: mark the entry as undone in place.
    // A paired inverse entry will appear after the next load — but the user sees the
    // immediate result right away.
    setEntries((prev) =>
      prev
        ? prev.map((e) =>
            e.id === log.id ? { ...e, undoneAt: new Date().toISOString() } : e
          )
        : prev
    );
    setUndoTarget(null);
  }

  async function loadMore() {
    if (!chatId || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.logs.list(chatId, {
        types: filterDef.types.length > 0 ? filterDef.types : undefined,
        q: q.trim() || undefined,
        before: nextBefore,
        limit: 50,
      });
      setEntries((prev) => (prev ? [...prev, ...page.entries] : page.entries));
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setLoadingMore(false);
    }
  }

  // Group entries by day for readability.
  const grouped = useMemo(() => {
    if (!entries) return null;
    const map = new Map<string, ActivityLogEntry[]>();
    for (const e of entries) {
      const k = dayKey(e.timestamp);
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    return Array.from(map.entries());
  }, [entries]);

  const titleSuffix = chat ? ` · ${chat.name}` : "";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title={`Registro${titleSuffix}`} onBack={() => navigate(`/chats/${chatId}`)} />

      <div className="yk-search">
        {I.search({ size: 18, stroke: "var(--ink-400)" })}
        <input
          placeholder="Buscar por usuario, motivo, palabra…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "0 16px 12px",
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const tone = f.tone || "brand";
          return (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                // Keep the URL in sync so refresh/share preserves the filter and
                // navigating back from a child screen lands on the same view.
                if (f.id === "todo") {
                  searchParams.delete("filter");
                } else {
                  searchParams.set("filter", f.id);
                }
                setSearchParams(searchParams, { replace: true });
              }}
              type="button"
              style={{
                border: active ? "1.5px solid var(--brand-400)" : "1.5px solid var(--ink-100)",
                background: active
                  ? tone === "warn"
                    ? "var(--warn-bg)"
                    : tone === "info"
                      ? "var(--info-bg)"
                      : tone === "danger"
                        ? "var(--danger-bg)"
                        : "var(--brand-50)"
                  : "var(--bg-card)",
                color: active
                  ? tone === "warn"
                    ? "var(--warn-fg)"
                    : tone === "info"
                      ? "var(--info-fg)"
                      : tone === "danger"
                        ? "var(--danger-fg)"
                        : "var(--brand-700)"
                  : "var(--ink-700)",
                cursor: "pointer",
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 999,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="yk-scroll yk-pad-nav">
        <div style={{ padding: "0 16px 16px" }}>
          <div
            className="yk-banner"
            style={{ margin: 0, background: "var(--bg-sunken)", color: "var(--ink-500)" }}
          >
            {I.help({ size: 18 })}
            <div>
              Historial de los últimos 90 días. Después se borra automáticamente para mantener la
              base de datos ligera.
            </div>
          </div>
        </div>

        {error && (
          <div className="yk-section">
            <div
              className="yk-banner"
              style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
            >
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        )}

        {entries === null && !error && (
          <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
        )}

        {entries && entries.length === 0 && (
          <div className="yk-section">
            <div className="yk-card">
              <div className="yk-empty">
                <div className="yk-empty-icon">{I.log({ size: 28 })}</div>
                <div className="yk-empty-title">No hay nada por aquí</div>
                <div>Prueba a cambiar el filtro o el texto de búsqueda.</div>
              </div>
            </div>
          </div>
        )}

        {grouped &&
          grouped.map(([day, items]) => (
            <div className="yk-section" key={day}>
              <div className="yk-section-label">{day.toUpperCase()}</div>
              <div className="yk-card">
                {items.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    showTopic={chat?.type === "topics"}
                    onOpenUser={
                      log.targetId !== null
                        ? () => navigate(`/chats/${chatId}/users/${log.targetId}`)
                        : undefined
                    }
                    onUndo={() => setUndoTarget(log)}
                  />
                ))}
              </div>
            </div>
          ))}

        {nextBefore && (
          <div style={{ padding: "0 16px 24px", display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              className="yk-btn outline"
              onClick={loadMore}
              disabled={loadingMore}
              style={{ width: "auto", padding: "10px 18px" }}
            >
              {loadingMore ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        )}
      </div>

      {undoTarget && (
        <LogUndoSheet
          log={undoTarget}
          onClose={() => setUndoTarget(null)}
          onConfirm={() => performUndo(undoTarget)}
        />
      )}
      <ScrollToTopButton containerRef={scrollRef} />
    </div>
  );
}
