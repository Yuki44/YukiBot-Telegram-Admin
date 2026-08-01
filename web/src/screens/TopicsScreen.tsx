import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { normalizeHttpUrl } from "../lib/url";
import type { Topic } from "../types/api";

export function TopicsScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One link shared by every topic's reminder, so it lives here, not per topic.
  const [btnOpen, setBtnOpen] = useState(false);
  const [btnEnabled, setBtnEnabled] = useState(false);
  const [btnText, setBtnText] = useState("");
  const [btnUrl, setBtnUrl] = useState("");
  const [btnBusy, setBtnBusy] = useState(false);
  const [btnSaved, setBtnSaved] = useState(false);
  const [btnError, setBtnError] = useState<string | null>(null);

  const canManage = chat?.role === "owner" || chat?.role === "super";

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
    api.topicReminder
      .get(chatId)
      .then((cfg) => {
        setBtnEnabled(!!cfg.button?.enabled);
        setBtnText(cfg.button?.text ?? "");
        setBtnUrl(cfg.button?.url ?? "");
      })
      .catch(() => {
        // Non-fatal: the topic list is the point of this screen.
      });  }, [chatId, navigate]);

  async function saveButton() {
    if (btnBusy || !chatId) return;
    setBtnError(null);
    setBtnSaved(false);
    if (btnEnabled) {
      if (btnText.trim().length === 0) {
        setBtnError("El botón necesita un texto.");
        return;
      }
      if (!normalizeHttpUrl(btnUrl)) {
        setBtnError("La URL del botón no es válida.");
        return;
      }
    }
    setBtnBusy(true);
    try {
      const updated = await api.topicReminder.update(chatId, {
        button: { enabled: btnEnabled, text: btnText, url: btnUrl },
      });
      setBtnEnabled(updated.button.enabled);
      setBtnText(updated.button.text);
      setBtnUrl(updated.button.url);
      setBtnSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        navigate("/login", { replace: true });
        return;
      }
      setBtnError(err instanceof Error ? err.message : "error");
    } finally {
      setBtnBusy(false);
    }
  }

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

        {canManage && (
          <div className="yk-section">
            <div className="yk-card">
              <button className="yk-row" onClick={() => setBtnOpen((v) => !v)}>
                <div className="yk-row-icon">{I.link({ size: 20 })}</div>
                <div className="yk-row-body">
                  <div className="yk-row-title">Botón de los recordatorios</div>
                  <div className="yk-row-sub">
                    {btnEnabled ? btnText || "Sin texto" : "Desactivado"} · el mismo para todos
                    los temas
                  </div>
                </div>
                <div className="yk-row-trail">{I.chevR()}</div>
              </button>

              {btnOpen && (
                <div style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: btnEnabled ? 16 : 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={btnEnabled}
                      onChange={(e) => {
                        setBtnEnabled(e.target.checked);
                        setBtnSaved(false);
                        setBtnError(null);
                      }}
                      disabled={btnBusy}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Añadir botón</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                        Aparece bajo el recordatorio de cada tema.
                      </div>
                    </div>
                  </label>

                  {btnEnabled && (
                    <>
                      <div className="yk-field" style={{ marginBottom: 12 }}>
                        <label className="yk-label" htmlFor="tr-btn-text">
                          Texto del botón
                        </label>
                        <input
                          id="tr-btn-text"
                          className="yk-input"
                          value={btnText}
                          onChange={(e) => {
                            setBtnText(e.target.value);
                            setBtnSaved(false);
                            setBtnError(null);
                          }}
                          placeholder="Ver todos nuestros grupos"
                          disabled={btnBusy}
                        />
                      </div>
                      <div className="yk-field" style={{ marginBottom: 12 }}>
                        <label className="yk-label" htmlFor="tr-btn-url">
                          URL del botón
                        </label>
                        <input
                          id="tr-btn-url"
                          className="yk-input"
                          value={btnUrl}
                          onChange={(e) => {
                            setBtnUrl(e.target.value);
                            setBtnSaved(false);
                            setBtnError(null);
                          }}
                          placeholder="t.me/tucanal"
                          disabled={btnBusy}
                        />
                      </div>
                    </>
                  )}

                  {btnError && (
                    <div
                      className="yk-banner"
                      style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
                    >
                      {I.alert({ size: 18 })}
                      <div>{btnError}</div>
                    </div>
                  )}
                  {btnSaved && (
                    <div
                      role="status"
                      style={{
                        background: "var(--brand-50)",
                        color: "var(--brand-700)",
                        padding: "8px 12px",
                        borderRadius: 12,
                        fontSize: 13,
                        marginBottom: 8,
                      }}
                    >
                      Guardado.
                    </div>
                  )}

                  <button type="button" className="yk-btn" onClick={saveButton} disabled={btnBusy}>
                    {btnBusy ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              )}
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
                      {t.reminder?.enabled ? " · Recordatorio" : ""}
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
