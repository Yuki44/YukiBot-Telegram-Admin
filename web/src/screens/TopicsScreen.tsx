import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import type { Topic } from "../types/api";

export function TopicsScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.topics
      .list(chatId)
      .then(setTopics)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [chatId, navigate]);

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Reglas por tema${chat ? ` · ${chat.name}` : ""}`}
        onBack={() => navigate(`/chats/${chatId}`)}
        action={{
          label: "Añadir tema",
          icon: I.plus({ size: 22 }),
          onClick: () => navigate(`/chats/${chatId}/topics/new`),
        }}
      />
      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Sobre los nombres</div>
            Los nombres se actualizan automáticamente cuando un tema se crea o renombra en
            Telegram. Si aparece como <b>Tema #ID</b>, aún no se ha sincronizado.
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

        {topics && topics.length > 0 && (
          <div className="yk-section">
            <div className="yk-card">
              {topics.map((t) => (
                <button
                  key={t.topicId}
                  className="yk-row"
                  onClick={() => navigate(`/chats/${chatId}/topics/${t.topicId}`)}
                >
                  <div className="yk-row-icon">{I.hash({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">{t.name || `Tema #${t.topicId}`}</div>
                    <div className="yk-row-sub">
                      {t.allowedMsgTypes.length === 0
                        ? "Sin tipos permitidos (todo se borra)"
                        : `${t.allowedMsgTypes.length} tipo${t.allowedMsgTypes.length === 1 ? "" : "s"} permitido${t.allowedMsgTypes.length === 1 ? "" : "s"}`}
                      {t.adminOnly ? " · Solo admins" : ""}
                    </div>
                  </div>
                  <div className="yk-row-trail">{I.chevR()}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {topics && topics.length === 0 && (
          <div className="yk-section">
            <div className="yk-banner">
              {I.help({ size: 18 })}
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Aún no hay reglas</div>
                Pulsa el <b>+</b> arriba para crear una regla para un tema concreto.
              </div>
            </div>
          </div>
        )}

        {topics === null && !error && (
          <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
        )}
      </div>
    </div>
  );
}
