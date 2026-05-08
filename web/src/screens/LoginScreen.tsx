import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { YukiLogo } from "../components/YukiLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { saveSession } from "../lib/auth";
import type { TelegramAuthData } from "../types/api";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthData) => void;
  }
}

export function LoginScreen() {
  const widgetRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const [pwUsername, setPwUsername] = useState("");
  const [pwPassword, setPwPassword] = useState("");
  const [pwShow, setPwShow] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [tgBusy, setTgBusy] = useState(false);
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgFallbackUrl, setTgFallbackUrl] = useState<string | null>(null);
  const [showResetHelp, setShowResetHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.onTelegramAuth = async (user: TelegramAuthData) => {
      setTgBusy(true);
      setTgError(null);
      try {
        const { token, user: authUser } = await api.auth.telegram(user);
        saveSession(token, authUser);
        navigate("/chats", { replace: true });
      } catch (err) {
        const code = err instanceof Error ? err.message : "error";
        if (code.includes("403")) setTgError("No tienes permisos de admin en ningún chat.");
        else if (code.includes("401"))
          setTgError("Firma de Telegram inválida o expirada. Intenta de nuevo.");
        else setTgError("No se pudo iniciar sesión. " + code);
        setTgBusy(false);
      }
    };

    api
      .publicConfig()
      .then((cfg) => {
        if (cancelled) return;
        const hasConfig = cfg.botUsername.length > 0 && cfg.botLoginDomain.length > 0;
        // The widget only renders correctly when the current host matches the BotFather
        // domain — otherwise it shows a "Bot domain invalid" iframe placeholder.
        const matches = hasConfig && window.location.hostname === cfg.botLoginDomain;
        if (matches) {
          setTgEnabled(true);
          const script = document.createElement("script");
          script.src = "https://telegram.org/js/telegram-widget.js?22";
          script.async = true;
          script.setAttribute("data-telegram-login", cfg.botUsername);
          script.setAttribute("data-size", "large");
          script.setAttribute("data-radius", "12");
          script.setAttribute("data-onauth", "onTelegramAuth(user)");
          script.setAttribute("data-request-access", "write");
          widgetRef.current?.appendChild(script);
          return;
        }
        if (hasConfig) {
          // Off-domain (e.g. local dev): show a fallback button that points users to the
          // production login URL where the official widget actually works.
          setTgFallbackUrl(`https://${cfg.botLoginDomain}/login`);
        }
      })
      .catch(() => {
        // Public config failure — silently keep Telegram hidden; password still works.
      });

    return () => {
      cancelled = true;
      delete window.onTelegramAuth;
    };
  }, [navigate]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwError(null);
    if (pwUsername.trim().length === 0 || pwPassword.length === 0) {
      setPwError("Introduce usuario y contraseña.");
      return;
    }
    setPwBusy(true);
    try {
      const { token, user } = await api.auth.password(pwUsername.trim(), pwPassword);
      saveSession(token, user);
      navigate("/chats", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) setPwError("Demasiados intentos. Espera unos minutos.");
        else if (err.status === 401) setPwError("Usuario o contraseña incorrectos.");
        else setPwError("No se pudo iniciar sesión. " + err.code);
      } else {
        setPwError("No se pudo iniciar sesión.");
      }
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="yk" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", top: 12, right: 12 }}>
        <ThemeToggle />
      </div>

      <div className="yk-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "56px 24px 24px", textAlign: "center" }}>
          <div style={{ margin: "0 auto 16px", display: "inline-flex" }}>
            <YukiLogo size={72} />
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Hola de nuevo
          </h1>
          <div style={{ color: "var(--ink-500)", marginTop: 6, fontSize: 15 }}>
            Configura tu YukiBot desde aquí 🌿
          </div>
        </div>

        <div style={{ padding: "8px 20px 20px", maxWidth: 420, width: "100%", margin: "0 auto" }}>
          <form onSubmit={submitPassword}>
            <div className="yk-field">
              <label className="yk-label" htmlFor="pw-username">
                Usuario
              </label>
              <div className="yk-input-wrap">
                <span className="yk-input-icon">{I.user({ size: 18 })}</span>
                <input
                  id="pw-username"
                  className="yk-input with-icon"
                  autoComplete="username"
                  placeholder="usuario"
                  value={pwUsername}
                  onChange={(e) => setPwUsername(e.target.value)}
                  disabled={pwBusy}
                />
              </div>
            </div>
            <div className="yk-field">
              <label className="yk-label" htmlFor="pw-password">
                Contraseña
              </label>
              <div className="yk-input-wrap">
                <span className="yk-input-icon">{I.lock({ size: 18 })}</span>
                <input
                  id="pw-password"
                  className="yk-input with-icon"
                  type={pwShow ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="contraseña"
                  value={pwPassword}
                  onChange={(e) => setPwPassword(e.target.value)}
                  disabled={pwBusy}
                />
                <button
                  type="button"
                  onClick={() => setPwShow((v) => !v)}
                  aria-label={pwShow ? "Ocultar contraseña" : "Mostrar contraseña"}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: 0,
                    padding: 8,
                    cursor: "pointer",
                    color: "var(--ink-400)",
                  }}
                >
                  {pwShow ? I.eyeOff({ size: 18 }) : I.eye({ size: 18 })}
                </button>
              </div>
              <div style={{ textAlign: "right", marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowResetHelp((v) => !v)}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--brand-700)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              {showResetHelp && (
                <div
                  className="yk-banner"
                  style={{ marginTop: 10, background: "var(--bg-sunken)", color: "var(--ink-700)" }}
                >
                  {I.help({ size: 18 })}
                  <div>
                    Pídele al propietario del grupo que la restablezca desde su panel. La opción
                    de auto-reseteo llegará pronto.
                  </div>
                </div>
              )}
            </div>

            {pwError && (
              <div
                role="alert"
                style={{
                  background: "var(--danger-50, #fee2e2)",
                  color: "var(--danger-700, #b91c1c)",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {pwError}
              </div>
            )}

            <button
              type="submit"
              className="yk-btn"
              disabled={pwBusy}
              style={{ marginTop: 8 }}
            >
              {pwBusy ? "Entrando…" : (
                <>
                  Entrar {I.arrowR({ size: 18 })}
                </>
              )}
            </button>
          </form>

          {(tgEnabled || tgFallbackUrl) && (
            <>
              <div
                aria-hidden
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: "20px 4px",
                }}
              >
                <div style={{ flex: 1, height: 1, background: "var(--ink-100)" }} />
                <span style={{ fontSize: 12, color: "var(--ink-400)", fontWeight: 600 }}>
                  O TAMBIÉN
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--ink-100)" }} />
              </div>

              {tgEnabled && (
                <div
                  ref={widgetRef}
                  style={{ minHeight: 48, display: "flex", justifyContent: "center" }}
                />
              )}

              {!tgEnabled && tgFallbackUrl && (
                <>
                  <a
                    href={tgFallbackUrl}
                    className="yk-btn"
                    style={{
                      background: "#229ED9",
                      color: "white",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {I.telegram({ size: 20 })} Continuar con Telegram
                  </a>
                  <div
                    style={{
                      color: "var(--ink-500)",
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 8,
                    }}
                  >
                    El login con Telegram solo funciona desde el dominio principal.
                  </div>
                </>
              )}

              {tgBusy && (
                <div
                  style={{ color: "var(--ink-500)", fontSize: 13, textAlign: "center", marginTop: 8 }}
                >
                  Verificando…
                </div>
              )}

              {tgError && (
                <div
                  role="alert"
                  style={{
                    background: "var(--danger-50, #fee2e2)",
                    color: "var(--danger-700, #b91c1c)",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  {tgError}
                </div>
              )}
            </>
          )}

          <div
            style={{
              textAlign: "center",
              marginTop: 24,
              fontSize: 13,
              color: "var(--ink-500)",
            }}
          >
            ¿No tienes acceso? Pídelo al admin del grupo.
          </div>
        </div>
      </div>
    </div>
  );
}
