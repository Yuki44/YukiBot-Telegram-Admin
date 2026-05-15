import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { SlideToConfirm } from "../components/SlideToConfirm";
import { StatusPills } from "../components/StatusPills";
import { UserAvatar } from "../components/UserAvatar";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { copyText, formatMembers, timeAgo } from "../lib/utils";
import type {
  ActionResult,
  ActivityLogEntry,
  ActivityLogType,
  UserRecord,
  UserStats,
} from "../types/api";

type Sheet = null | "warn" | "silence" | "unsilence" | "ban" | "unban" | "pardon";

interface LogTypeMeta {
  icon: ReactNode;
  bg: string;
  fg: string;
  label: string;
}

function logMeta(type: ActivityLogType): LogTypeMeta {
  switch (type) {
    case "warn":
      return { icon: I.alert({ size: 14 }), bg: "var(--warn-bg)", fg: "var(--warn-fg)", label: "Aviso" };
    case "unwarn":
      return { icon: I.refresh({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Quitar aviso" };
    case "silence":
      return { icon: I.silence({ size: 14 }), bg: "var(--info-bg)", fg: "var(--info-fg)", label: "Silencio" };
    case "unsilence":
      return { icon: I.silence({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: "Quitar silencio" };
    case "ban":
    case "autoban":
      return { icon: I.ban({ size: 14 }), bg: "var(--danger-bg)", fg: "var(--danger-fg)", label: type === "autoban" ? "Auto-ban" : "Ban" };
    case "unban":
    case "pardon":
      return { icon: I.check({ size: 14 }), bg: "var(--ok-bg)", fg: "var(--ok-fg)", label: type === "pardon" ? "Perdón" : "Quitar ban" };
    case "kick":
      return { icon: I.logout({ size: 14 }), bg: "var(--danger-bg)", fg: "var(--danger-fg)", label: "Expulsión" };
    default:
      return { icon: I.log({ size: 14 }), bg: "var(--ink-100)", fg: "var(--ink-700)", label: "Acción" };
  }
}

interface SheetCfg {
  title: string;
  desc: string;
  slideLabel: string;
  needsReason?: boolean;
  reasonRequired?: boolean;
  danger?: boolean;
  icon: ReactNode;
}

function displayName(u: UserRecord): string {
  return u.name?.trim() || u.username?.trim() || `ID ${u.userId}`;
}

function sheetConfig(kind: Exclude<Sheet, null>, user: UserRecord): SheetCfg {
  const display = displayName(user);
  switch (kind) {
    case "warn":
      return {
        title: `Dar aviso a ${display}`,
        desc: `Pasará a ${Math.min(3, user.warnings + 1)}/3. Al llegar a 3 se banea automáticamente.`,
        slideLabel: "Desliza para avisar",
        needsReason: true,
        reasonRequired: true,
        icon: I.alert({ size: 20 }),
      };
    case "silence":
      return {
        title: `Silenciar a ${display}`,
        desc: "No podrá escribir durante una semana.",
        slideLabel: "Desliza para silenciar",
        icon: I.silence({ size: 20 }),
      };
    case "unsilence":
      return {
        title: `Quitar silencio a ${display}`,
        desc: "Podrá volver a escribir inmediatamente.",
        slideLabel: "Desliza para quitar silencio",
        icon: I.check({ size: 20 }),
      };
    case "ban":
      return {
        title: `Banear a ${display}`,
        desc: "Echa al usuario y le impide volver. Si vuelve por enlace, se le re-banea automáticamente.",
        slideLabel: "Desliza para banear",
        needsReason: true,
        danger: true,
        icon: I.ban({ size: 20 }),
      };
    case "unban":
      return {
        title: `Quitar el ban a ${display}`,
        desc: "Borra el ban. El usuario podrá volver al grupo si tiene un enlace de invitación.",
        slideLabel: "Desliza para quitar ban",
        icon: I.check({ size: 20 }),
      };
    case "pardon":
      return {
        title: `Perdonar a ${display}`,
        desc: "Borra todos los avisos y el registro completo. Solo el propietario puede hacer esto.",
        slideLabel: "Desliza para perdonar",
        danger: true,
        icon: I.check({ size: 20 }),
      };
  }
}

interface ActionSheetProps {
  kind: Exclude<Sheet, null>;
  user: UserRecord;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function ActionSheet({ kind, user, onClose, onConfirm }: ActionSheetProps) {
  const cfg = sheetConfig(kind, user);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function confirm() {
    if (cfg.reasonRequired && !reason.trim()) {
      setError("Escribe un motivo antes de confirmar.");
      setResetKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
      setBusy(false);
      setResetKey((k) => k + 1);
    }
  }

  return (
    <div className="yk-sheet-overlay" onClick={onClose}>
      <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yk-sheet-handle" />
        <div style={{ padding: "8px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div
              className="yk-row-icon"
              style={cfg.danger ? { background: "var(--danger-bg)", color: "var(--danger-fg)" } : undefined}
            >
              {cfg.icon}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{cfg.title}</div>
          </div>
          <div
            style={{
              color: "var(--ink-500)",
              fontSize: 14,
              marginBottom: 16,
              whiteSpace: "normal",
            }}
          >
            {cfg.desc}
          </div>

          {cfg.needsReason && (
            <div className="yk-field" style={{ marginBottom: 14 }}>
              <label className="yk-label">{cfg.reasonRequired ? "Motivo" : "Motivo (opcional)"}</label>
              <input
                className="yk-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={cfg.reasonRequired ? "Por qué se le avisa" : ""}
                autoFocus
                disabled={busy}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                background: "var(--danger-bg)",
                color: "var(--danger-fg)",
                padding: "8px 12px",
                borderRadius: 12,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <SlideToConfirm
            label={busy ? "Aplicando…" : cfg.slideLabel}
            danger={cfg.danger}
            disabled={busy}
            resetKey={resetKey}
            onConfirm={confirm}
            icon={cfg.icon}
          />

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              marginTop: 12,
              width: "100%",
              padding: 12,
              background: "transparent",
              border: 0,
              color: "var(--ink-500)",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export function UserDetailScreen() {
  const { chatId, userId } = useParams<{ chatId: string; userId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [history, setHistory] = useState<ActivityLogEntry[] | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);

  function load() {
    if (!chatId || !userId) return;
    api.users
      .get(chatId, userId)
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setError("Este usuario no tiene registro en YukiBot todavía.");
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }

  useEffect(load, [chatId, userId, navigate]);

  useEffect(() => {
    if (!chatId || !user) return;
    // Fetch a recent slice of logs and filter client-side by targetId — q matches text
    // fields and could pull in noise; client-side filter is the only reliable cut.
    let cancelled = false;
    api.logs
      .list(chatId, { limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setHistory(page.entries.filter((e) => e.targetId === user.userId).slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    api.users
      .stats(chatId, user.userId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats({ messagesLast30d: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, user]);

  function applyResult(r: ActionResult) {
    setUser(r.user);
    setSheet(null);
    if (!r.enforced) {
      setError(
        "Cambio guardado en MongoDB pero la API de Telegram falló: " +
          (r.enforceError ?? "error desconocido") +
          ". El bot intentará re-aplicar la próxima vez que el usuario interactúe."
      );
    } else {
      setError(null);
    }
  }

  async function refreshFromTelegram() {
    if (!chatId || !user || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const updated = await api.users.refresh(chatId, user.userId);
      setUser(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === "telegram_member_not_found") {
        setError("Telegram no encuentra al usuario en este chat (¿se fue del grupo?).");
      } else {
        setError("No se pudo refrescar desde Telegram.");
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function runAction(kind: Exclude<Sheet, null>, reason: string): Promise<void> {
    if (!chatId || !user) return;
    const uid = user.userId;
    switch (kind) {
      case "warn": {
        const r = await api.users.warn(chatId, uid, reason);
        applyResult(r);
        break;
      }
      case "silence": {
        const r = await api.users.silence(chatId, uid);
        applyResult(r);
        break;
      }
      case "unsilence": {
        const r = await api.users.unsilence(chatId, uid);
        applyResult(r);
        break;
      }
      case "ban": {
        const r = await api.users.ban(chatId, uid, reason);
        applyResult(r);
        break;
      }
      case "unban": {
        const r = await api.users.unban(chatId, uid);
        applyResult(r);
        break;
      }
      case "pardon": {
        await api.users.pardon(chatId, uid);
        navigate(`/chats/${chatId}/users`);
        break;
      }
    }
  }

  async function doCopyId() {
    if (!user) return;
    if (await copyText(String(user.userId))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const titleSuffix = chat ? ` · ${chat.name}` : "";

  if (!user && error) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title={`Usuario${titleSuffix}`} onBack={() => navigate(`/chats/${chatId}/users`)} />
        <div className="yk-section">
          <div
            className="yk-banner"
            style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
          >
            {I.alert({ size: 18 })}
            <div>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title={`Usuario${titleSuffix}`} onBack={() => navigate(`/chats/${chatId}/users`)} />
        <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
      </div>
    );
  }

  const display = displayName(user);
  const noName = !user.name?.trim() && !user.username?.trim();

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Usuario${titleSuffix}`}
        onBack={() => navigate(`/chats/${chatId}/users`)}
        action={{
          label: "Más opciones",
          icon: I.more({ size: 20 }),
          onClick: () => setMoreOpen(true),
        }}
      />

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 20px 16px", textAlign: "center" }}>
          <div style={{ display: "inline-block", marginBottom: 12 }}>
            <UserAvatar
              name={noName ? "" : display}
              photoFileId={user.photoFileId}
              size={80}
            />
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              color: noName ? "var(--ink-500)" : undefined,
              fontStyle: noName ? "italic" : undefined,
            }}
          >
            {noName ? "Sin nombre" : display}
          </div>
          <div style={{ color: "var(--ink-500)", fontSize: 14, marginTop: 2 }}>
            {user.username ? (
              `@${user.username.replace(/^@/, "")}`
            ) : (
              <span style={{ color: "var(--ink-400)", fontStyle: "italic" }}>sin @usuario</span>
            )}
          </div>

          <div style={{ display: "inline-flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={doCopyId}
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: "var(--bg-sunken)",
                border: 0,
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: "var(--ink-700)",
              }}
            >
              ID {user.userId}
              {copied ? I.check({ size: 14, stroke: "var(--ok-fg)" }) : I.copy({ size: 14 })}
            </button>
            <a
              href={user.username ? `https://t.me/${user.username.replace(/^@/, "")}` : `tg://user?id=${user.userId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: "var(--brand-50)",
                border: "1px solid var(--brand-200)",
                color: "var(--brand-700)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {I.telegram({ size: 14 })}
              Abrir en Telegram
            </a>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {user.isAdmin && <span className="yk-chip brand">Admin del chat</span>}
            <StatusPills user={user} />
          </div>

          {refreshing && (
            <div style={{ marginTop: 8, color: "var(--ink-500)", fontSize: 13 }}>
              Refrescando desde Telegram…
            </div>
          )}
          {noName && !refreshing && (
            <div style={{ marginTop: 8, color: "var(--ink-500)", fontSize: 12 }}>
              Sin datos en caché. Abre el menú <span aria-hidden>⋯</span> arriba a la derecha y
              pulsa <i>Refrescar desde Telegram</i>. Si Telegram tampoco devuelve nombre, la
              cuenta probablemente está borrada.
            </div>
          )}
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

        <div className="yk-stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="yk-stat">
            <div className="yk-stat-num" style={{ color: "var(--warn-fg)" }}>
              {user.warnings}/3
            </div>
            <div className="yk-stat-label">AVISOS</div>
          </div>
          <div className="yk-stat">
            <div className="yk-stat-num">{user.warningReasons.length}</div>
            <div className="yk-stat-label">MOTIVOS</div>
          </div>
          <div className="yk-stat">
            <div className="yk-stat-num">
              {stats ? formatMembers(stats.messagesLast30d) : "…"}
            </div>
            <div className="yk-stat-label">MENSAJES (30D)</div>
          </div>
        </div>

        {user.isAdmin && (
          <div className="yk-section">
            <div className="yk-banner">
              {I.shield({ size: 18 })}
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Es admin de este chat</div>
                Las acciones de moderación están desactivadas. Para retirarle el rol, ve a
                Telegram (Configuración del grupo · Administradores).
              </div>
            </div>
          </div>
        )}

        <div className="yk-section">
          <div className="yk-section-label">ACCIONES</div>
          <div className="yk-card" style={user.isAdmin ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
            {!user.isBanned && (
              <>
                <button className="yk-row" onClick={() => setSheet("warn")} type="button" disabled={user.isAdmin}>
                  <div className="yk-row-icon warm">{I.alert({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Dar aviso</div>
                    <div className="yk-row-sub">Pasaría a {Math.min(3, user.warnings + 1)}/3</div>
                  </div>
                  <div className="yk-row-trail">{I.chevR()}</div>
                </button>
                {user.isMuted ? (
                  <button className="yk-row" onClick={() => setSheet("unsilence")} type="button" disabled={user.isAdmin}>
                    <div className="yk-row-icon">{I.check({ size: 20 })}</div>
                    <div className="yk-row-body">
                      <div className="yk-row-title">Quitar silencio</div>
                      <div className="yk-row-sub">Podrá escribir de nuevo</div>
                    </div>
                    <div className="yk-row-trail">{I.chevR()}</div>
                  </button>
                ) : (
                  <button className="yk-row" onClick={() => setSheet("silence")} type="button" disabled={user.isAdmin}>
                    <div className="yk-row-icon info">{I.silence({ size: 20 })}</div>
                    <div className="yk-row-body">
                      <div className="yk-row-title">Silenciar 1 semana</div>
                      <div className="yk-row-sub">No podrá escribir por una semana</div>
                    </div>
                    <div className="yk-row-trail">{I.chevR()}</div>
                  </button>
                )}
                <button className="yk-row" onClick={() => setSheet("ban")} type="button" disabled={user.isAdmin}>
                  <div className="yk-row-icon danger">{I.ban({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title" style={{ color: "var(--danger-fg)" }}>
                      Banear permanentemente
                    </div>
                    <div className="yk-row-sub">Echa al usuario y le impide volver</div>
                  </div>
                  <div className="yk-row-trail">{I.chevR()}</div>
                </button>
              </>
            )}
            {user.isBanned && (
              <>
                <button className="yk-row" onClick={() => setSheet("unban")} type="button">
                  <div
                    className="yk-row-icon"
                    style={{ background: "var(--ok-bg)", color: "var(--ok-fg)" }}
                  >
                    {I.check({ size: 20 })}
                  </div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Quitar el ban</div>
                    <div className="yk-row-sub">Permite volver al grupo (avisos se mantienen)</div>
                  </div>
                  <div className="yk-row-trail">{I.chevR()}</div>
                </button>
                <button className="yk-row" onClick={() => setSheet("pardon")} type="button">
                  <div className="yk-row-icon danger">{I.trash({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Perdonar (borrar registro)</div>
                    <div className="yk-row-sub">Solo el propietario · Borra avisos y ban</div>
                  </div>
                  <div className="yk-row-trail">{I.chevR()}</div>
                </button>
              </>
            )}
          </div>
        </div>

        {user.warningReasons.length > 0 && (
          <div className="yk-section">
            <div className="yk-section-label">MOTIVOS DE LOS AVISOS</div>
            <div className="yk-card">
              {user.warningReasons.map((r, i) => (
                <div className="yk-row" key={i} style={{ cursor: "default" }}>
                  <div className="yk-row-icon warm">{I.alert({ size: 18 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Aviso {i + 1}</div>
                    <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
                      {r}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {history && history.length > 0 && (
          <div className="yk-section">
            <div
              className="yk-section-label"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span>HISTORIAL</span>
              <button
                type="button"
                onClick={() => navigate(`/chats/${chatId}/logs`)}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "var(--brand-700)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                VER TODO
              </button>
            </div>
            <div className="yk-card">
              {history.map((log) => {
                const m = logMeta(log.type);
                return (
                  <div className="yk-row" key={log.id} style={{ cursor: "default", alignItems: "flex-start" }}>
                    <div
                      className="yk-row-icon"
                      style={{ background: m.bg, color: m.fg, marginTop: 2, flexShrink: 0 }}
                    >
                      {m.icon}
                    </div>
                    <div className="yk-row-body">
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <div style={{ flex: 1, fontWeight: 700 }}>{m.label}</div>
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
                      {log.reason && (
                        <div
                          className="yk-row-sub"
                          style={{ whiteSpace: "normal", marginTop: 2 }}
                        >
                          {log.reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {moreOpen && (
        <div className="yk-sheet-overlay" onClick={() => setMoreOpen(false)}>
          <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="yk-sheet-handle" />
            <div style={{ padding: "8px 12px 16px" }}>
              <div className="yk-card" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className="yk-row"
                  onClick={() => {
                    setMoreOpen(false);
                    refreshFromTelegram();
                  }}
                  disabled={refreshing}
                >
                  <div className="yk-row-icon">{I.refresh({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Refrescar desde Telegram</div>
                    <div className="yk-row-sub">Sincroniza nombre, foto y estado.</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="yk-row"
                  onClick={() => {
                    setMoreOpen(false);
                    doCopyId();
                  }}
                >
                  <div className="yk-row-icon">{I.copy({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Copiar ID de Telegram</div>
                    <div className="yk-row-sub">{user.userId}</div>
                  </div>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: 12,
                  background: "transparent",
                  border: 0,
                  color: "var(--ink-500)",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <ActionSheet
          kind={sheet}
          user={user}
          onClose={() => setSheet(null)}
          onConfirm={(reason) => runAction(sheet, reason)}
        />
      )}
    </div>
  );
}
