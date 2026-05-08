import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import type { ChatDetail, ChatStats } from "../types/api";

interface NavRowProps {
  icon: ReactNode;
  iconClass?: string;
  title: string;
  sub: string;
  trail?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

function NavRow({ icon, iconClass, title, sub, trail, disabled, onClick }: NavRowProps) {
  const Tag: keyof JSX.IntrinsicElements = disabled ? "div" : "button";
  return (
    <Tag
      className="yk-row"
      onClick={disabled ? undefined : onClick}
      style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}
    >
      <div className={`yk-row-icon${iconClass ? " " + iconClass : ""}`}>{icon}</div>
      <div className="yk-row-body">
        <div className="yk-row-title">{title}</div>
        <div className="yk-row-sub">{sub}</div>
      </div>
      <div className="yk-row-trail">
        {trail}
        {!disabled && I.chevR()}
      </div>
    </Tag>
  );
}

function featureCount(chat: ChatDetail): { on: number; total: number } {
  const entries = Object.values(chat.features);
  return { on: entries.filter(Boolean).length, total: entries.length };
}

export function DashboardScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [stats, setStats] = useState<ChatStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.chats
      .get(chatId)
      .then(setChat)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setError("No tienes permisos en este chat.");
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [chatId, navigate]);

  // Stats render lazily — failure is non-fatal so the dashboard still works.
  useEffect(() => {
    if (!chatId) return;
    api.chats.stats(chatId).then(setStats).catch(() => setStats(null));
  }, [chatId]);

  if (error) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title="Panel del chat" onBack={() => navigate("/chats")} />
        <div className="yk-scroll yk-pad-nav">
          <div className="yk-section">
            <div
              className="yk-banner"
              style={{ background: "var(--danger-50, #fee2e2)", color: "var(--danger-700, #b91c1c)" }}
            >
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title="Panel del chat" onBack={() => navigate("/chats")} />
        <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
      </div>
    );
  }

  const { on, total } = featureCount(chat);
  const roleLabel =
    chat.role === "super" ? "Super-admin" : chat.role === "owner" ? "Propietario" : "Admin";
  const typeLabel = chat.type === "topics" ? "Con temas" : "Grupo";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title="Panel del chat" onBack={() => navigate("/chats")} />

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "4px 16px 16px" }}>
          <div className="yk-card" style={{ padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
            <div
              className="yk-avatar yk-av-3"
              style={{
                borderRadius: 18,
                width: 56,
                height: 56,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-hidden
            >
              {chat.type === "topics" ? I.hash({ size: 28 }) : I.group({ size: 28 })}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>{chat.name}</div>
              <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2 }}>
                ID {chat.chatId}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <span className={`yk-chip ${chat.isActive ? "ok" : ""}`}>
                  <span className={`yk-dot ${chat.isActive ? "ok" : ""}`} />
                  {chat.isActive ? "Bot activo" : "Inactivo"}
                </span>
                <span className="yk-chip">{roleLabel}</span>
                <span className="yk-chip">{typeLabel}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="yk-stats">
          <button
            type="button"
            className="yk-stat yk-stat-btn"
            onClick={() => navigate(`/chats/${chat.chatId}/logs?filter=warn`)}
          >
            <div className="yk-stat-num" style={{ color: "var(--warn-fg)" }}>
              {stats ? stats.warnedCount : "—"}
            </div>
            <div className="yk-stat-label">CON AVISOS</div>
          </button>
          <button
            type="button"
            className="yk-stat yk-stat-btn"
            onClick={() => navigate(`/chats/${chat.chatId}/logs?filter=silence`)}
          >
            <div className="yk-stat-num" style={{ color: "var(--info-fg)" }}>
              {stats ? stats.silencedCount : "—"}
            </div>
            <div className="yk-stat-label">SILENCIADOS</div>
          </button>
          <button
            type="button"
            className="yk-stat yk-stat-btn"
            onClick={() => navigate(`/chats/${chat.chatId}/logs?filter=ban`)}
          >
            <div className="yk-stat-num" style={{ color: "var(--danger-fg)" }}>
              {stats ? stats.bannedCount : "—"}
            </div>
            <div className="yk-stat-label">BANEADOS</div>
          </button>
          <button
            type="button"
            className="yk-stat yk-stat-btn"
            onClick={() => navigate(`/chats/${chat.chatId}/logs?filter=todo`)}
          >
            <div className="yk-stat-num">{stats ? stats.actionsToday : "—"}</div>
            <div className="yk-stat-label">ACCIONES HOY</div>
          </button>
        </div>

        <div className="yk-section">
          <div className="yk-section-label">GESTIÓN</div>
          <div className="yk-card">
            <NavRow
              icon={I.users({ size: 20 })}
              title="Usuarios"
              sub="Buscar, ver avisos, silenciar, banear"
              onClick={() => navigate(`/chats/${chat.chatId}/users`)}
            />
            {chat.type === "topics" && (
              <NavRow
                icon={I.hash({ size: 20 })}
                title="Reglas por tema"
                sub="Qué se permite en cada apartado del foro"
                onClick={() => navigate(`/chats/${chat.chatId}/topics`)}
              />
            )}
            <NavRow
              icon={I.log({ size: 20 })}
              iconClass="info"
              title="Registro"
              sub="Todo lo que hace el bot, paso a paso"
              onClick={() => navigate(`/chats/${chat.chatId}/logs`)}
            />
          </div>
        </div>

        <div className="yk-section">
          <div className="yk-section-label">FUNCIONES DEL BOT</div>
          <div className="yk-card">
            <NavRow
              icon={I.toggle({ size: 20 })}
              iconClass="warm"
              title="Activar/desactivar funciones"
              sub={`${on} de ${total} activas`}
              onClick={() => navigate(`/chats/${chat.chatId}/features`)}
            />
            <NavRow
              icon={I.shield({ size: 20 })}
              title="Permitidos en este chat"
              sub={`${chat.linkWhitelist.length} enlaces · ${chat.spamUserWhitelist.length} usuarios`}
              onClick={() => navigate(`/chats/${chat.chatId}/whitelist`)}
            />
            <NavRow
              icon={I.word({ size: 20 })}
              iconClass="danger"
              title="Palabras prohibidas"
              sub="Reglas que YukiBot aprenderá a aplicar pronto"
              onClick={() => navigate(`/chats/${chat.chatId}/banned-words`)}
            />
            <NavRow
              icon={I.users({ size: 20 })}
              iconClass="neutral"
              title="Equipo de admins"
              sub="Quién tiene acceso a este chat"
              onClick={() => navigate(`/chats/${chat.chatId}/admins`)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
