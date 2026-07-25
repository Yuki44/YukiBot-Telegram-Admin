import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";

const MAX_LEN = 1024;

/** Map an API error code to a friendly Spanish message. */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Solo el propietario puede cambiar la bienvenida.";
    switch (err.code) {
      case "invalid_message":
      case "message_too_long":
        return "El mensaje no es válido o es demasiado largo.";
      case "button_text_required":
        return "El botón necesita un texto.";
      case "invalid_button_url":
        return "La URL del botón no es válida.";
      case "invalid_button":
        return "La configuración del botón no es válida.";
    }
  }
  return err instanceof Error ? err.message : "error";
}

/**
 * Mirror of src/utils/url.ts — a bare "t.me/x" is accepted (the server prepends
 * https://); only a non-http(s) scheme or unparseable input is rejected.
 */
function normalizeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s);
  let candidate: string;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    candidate = s;
  } else {
    candidate = `https://${s}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function WelcomeScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);

  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [buttonEnabled, setButtonEnabled] = useState(false);
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canManage = chat?.role === "owner" || chat?.role === "super";

  function handleApiErr(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      navigate("/login", { replace: true });
      return;
    }
    setError(errorMessage(err));
  }

  useEffect(() => {
    if (!chatId) return;
    api.welcome
      .get(chatId)
      .then((w) => {
        setMessage(w.message ?? "");
        setButtonEnabled(!!w.button?.enabled);
        setButtonText(w.button?.text ?? "");
        setButtonUrl(w.button?.url ?? "");
        setLoaded(true);
      })
      .catch(handleApiErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Any edit invalidates the "saved" confirmation and clears stale errors.
  function dirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setSaved(false);
      setError(null);
    };
  }

  async function save() {
    if (busy || !chatId) return;
    setError(null);
    setSaved(false);
    if (message.trim().length === 0) {
      setError("Escribe el mensaje de bienvenida.");
      return;
    }
    if (message.length > MAX_LEN) {
      setError("El mensaje es demasiado largo.");
      return;
    }
    if (buttonEnabled) {
      if (buttonText.trim().length === 0) {
        setError("El botón necesita un texto.");
        return;
      }
      if (!normalizeHttpUrl(buttonUrl)) {
        setError("La URL del botón no es válida.");
        return;
      }
    }
    setBusy(true);
    try {
      const updated = await api.welcome.update(chatId, {
        message,
        button: { enabled: buttonEnabled, text: buttonText, url: buttonUrl },
      });
      setMessage(updated.message);
      setButtonEnabled(updated.button.enabled);
      setButtonText(updated.button.text);
      setButtonUrl(updated.button.url);
      setSaved(true);
    } catch (err) {
      handleApiErr(err);
    } finally {
      setBusy(false);
    }
  }

  const titleSuffix = chat ? ` · ${chat.name}` : "";
  const disabled = busy || !canManage;

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Mensaje de bienvenida${titleSuffix}`}
        onBack={() => navigate(`/chats/${chatId}`)}
      />
      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>
            Se envía una sola vez a cada usuario que entra (si la función está activada en
            Funciones). Escribe estos códigos tal cual y el bot los rellena solo:{" "}
            <code>@usuario</code> = el usuario que entra (su @usuario o, si no tiene, su
            nombre); <code>@nombreGrupo</code> = el nombre de este grupo. No escribas el
            usuario ni el nombre del grupo a mano.
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

        <div className="yk-section">
          <div className="yk-card">
            {!loaded ? (
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            ) : (
              <div style={{ padding: 16 }}>
                <div className="yk-field" style={{ marginBottom: 16 }}>
                  <label className="yk-label" htmlFor="wl-msg">
                    Mensaje
                  </label>
                  <textarea
                    id="wl-msg"
                    className="yk-textarea"
                    rows={5}
                    placeholder="Bienvenido @usuario a @nombreGrupo…"
                    value={message}
                    onChange={(e) => dirty(setMessage)(e.target.value)}
                    disabled={disabled}
                    maxLength={MAX_LEN}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-500)",
                      marginTop: 4,
                      textAlign: "right",
                    }}
                  >
                    {message.length}/{MAX_LEN}
                  </div>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: buttonEnabled ? 16 : 6,
                    cursor: disabled ? "default" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={buttonEnabled}
                    onChange={(e) => dirty(setButtonEnabled)(e.target.checked)}
                    disabled={disabled}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Añadir botón</div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                      Un botón bajo el mensaje que abre un enlace al pulsarlo.
                    </div>
                  </div>
                </label>

                {buttonEnabled && (
                  <>
                    <div className="yk-field" style={{ marginBottom: 12 }}>
                      <label className="yk-label" htmlFor="wl-btn-text">
                        Texto del botón
                      </label>
                      <input
                        id="wl-btn-text"
                        className="yk-input"
                        value={buttonText}
                        onChange={(e) => dirty(setButtonText)(e.target.value)}
                        placeholder="Suscríbete a este canal"
                        disabled={disabled}
                      />
                    </div>
                    <div className="yk-field" style={{ marginBottom: 12 }}>
                      <label className="yk-label" htmlFor="wl-btn-url">
                        URL del botón
                      </label>
                      <input
                        id="wl-btn-url"
                        className="yk-input"
                        value={buttonUrl}
                        onChange={(e) => dirty(setButtonUrl)(e.target.value)}
                        placeholder="t.me/tucanal"
                        disabled={disabled}
                      />
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--ink-500)",
                          marginTop: 4,
                        }}
                      >
                        Puedes pegar el enlace sin <code>https://</code>; se añade solo.
                      </div>
                    </div>
                  </>
                )}

                {saved && (
                  <div
                    role="status"
                    style={{
                      background: "var(--brand-50)",
                      color: "var(--brand-700)",
                      padding: "8px 12px",
                      borderRadius: 12,
                      fontSize: 13,
                      marginTop: 8,
                      marginBottom: 8,
                    }}
                  >
                    Guardado.
                  </div>
                )}

                <button
                  type="button"
                  className="yk-btn"
                  onClick={save}
                  disabled={disabled}
                  style={{ marginTop: 12 }}
                >
                  {busy ? "Guardando…" : "Guardar"}
                </button>
                {!canManage && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-500)",
                      marginTop: 8,
                      textAlign: "center",
                    }}
                  >
                    Solo el propietario puede cambiar la bienvenida.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
