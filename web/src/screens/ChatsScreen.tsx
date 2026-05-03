import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { api } from "../lib/api";
import { ApiError } from "../lib/api";
import { clearSession, getStoredUser } from "../lib/auth";
import type { ChatSummary } from "../types/api";

function ChatRow({ chat, onClick }: { chat: ChatSummary; onClick: () => void }) {
  const icon = chat.type === "topics" ? I.hash({ size: 22 }) : I.group({ size: 22 });
  const roleLabel =
    chat.role === "super" ? "Super-admin" : chat.role === "owner" ? "Propietario" : "Admin";
  const typeLabel = chat.type === "topics" ? "Con temas" : "Grupo";

  return (
    <button className="yk-row" onClick={onClick}>
      <div
        className="yk-avatar yk-av-3"
        style={{
          borderRadius: 14,
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-hidden
      >
        {icon}
      </div>
      <div className="yk-row-body">
        <div className="yk-row-title">{chat.name}</div>
        <div className="yk-row-sub">
          {roleLabel} · {typeLabel}
          {!chat.isActive && " · Inactivo"}
        </div>
      </div>
      <div className="yk-row-trail">{I.chevR()}</div>
    </button>
  );
}

export function ChatsScreen() {
  const navigate = useNavigate();
  const storedUser = getStoredUser();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.chats
      .list()
      .then(setChats)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [navigate]);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  const greetingName = storedUser?.name?.split(" ")[0] ?? storedUser?.username ?? "admin";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title="Mis chats"
        action={{ label: "Cerrar sesión", icon: I.logout({ size: 20 }), onClick: logout }}
      />

      <div className="yk-scroll yk-pad-nav">
        <div className="yk-hero" style={{ paddingTop: 0 }}>
          <h1>Hola, {greetingName} 👋</h1>
          <div className="yk-hero-sub">
            {chats === null
              ? "Cargando tus chats…"
              : chats.length === 1
                ? "Tienes acceso a 1 chat."
                : `Tienes acceso a ${chats.length} chats.`}
          </div>
        </div>

        {error && (
          <div className="yk-section">
            <div
              role="alert"
              className="yk-banner"
              style={{ background: "var(--danger-50, #fee2e2)", color: "var(--danger-700, #b91c1c)" }}
            >
              {I.alert({ size: 18 })}
              <div>No se pudieron cargar los chats. {error}</div>
            </div>
          </div>
        )}

        {chats && chats.length > 0 && (
          <div className="yk-section">
            <div className="yk-section-label">CHATS QUE MODERAS</div>
            <div className="yk-card">
              {chats.map((c) => (
                <ChatRow key={c.chatId} chat={c} onClick={() => navigate(`/chats/${c.chatId}`)} />
              ))}
            </div>
          </div>
        )}

        {chats && chats.length === 0 && (
          <div className="yk-section">
            <div className="yk-banner">
              {I.help({ size: 18 })}
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Aún no hay chats</div>
                Añade YukiBot a un grupo y ejecuta <code>/setup</code> dentro del grupo para
                registrarlo. Después aparecerá aquí.
              </div>
            </div>
          </div>
        )}

        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>¿Te falta algún chat?</div>
            Solo aparecen los chats donde eres admin u owner. Pídele al propietario que te dé acceso
            si te falta alguno.
          </div>
        </div>
      </div>
    </div>
  );
}
