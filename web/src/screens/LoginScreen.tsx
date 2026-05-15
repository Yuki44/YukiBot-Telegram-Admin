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
  // Stores the resolved bot username when the domain check passes.
  // Setting this triggers the second effect below which injects the widget script
  // safely AFTER React has rendered the container div (making widgetRef.current available).
  const [widgetUsername, setWidgetUsername] = useState<string | null>(null);
  const [showResetHelp, setShowResetHelp] = useState(false);

  // Effect 1 — register the Telegram auth callback and fetch public config.
  // Does NOT touch the DOM; only updates state once config is available.
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
        const expected = cfg.botLoginDomain.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
        const actual = window.location.hostname.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
        const username = cfg.botUsername.trim().replace(/^@/, "");
        const hasConfig = username.length > 0 && expected.length > 0;
        const matches = hasConfig && actual === expected;
        // Diagnostic — one-line console hint so the user can confirm the comparison
        // without us guessing what their env value actually is.
        if (hasConfig) {
          // eslint-disable-next-line no-console
          console.info(`[login] telegram widget: expected=${expected} got=${actual} match=${matches}`);
        }
        if (matches) {
          // Setting widgetUsername causes React to render the widget container div, which
          // makes widgetRef.current non-null. Effect 2 (below) picks it up and injects
          // the script after that render completes — avoiding the null-ref race.
          setWidgetUsername(username);
          return;
        }
        if (hasConfig) {
          // Off-domain (e.g. local dev): show a fallback button that points users to the
          // production login URL where the official widget actually works.
          setTgFallbackUrl(`https://${expected}/login`);
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

  // Effect 2 — inject the Telegram widget script.
  // Runs AFTER the render triggered by setWidgetUsername(), so widgetRef.current is
  // guaranteed to be a mounted DOM node at this point.
  useEffect(() => {
    if (!widgetUsername || !widgetRef.current) return;
    setTgEnabled(true);
    // Clear any previous children (guards against React strict-mode double-mount in dev).
    widgetRef.current.replaceChildren();
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", widgetUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetRef.current.appendChild(script);
  }, [widgetUsername]);

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
            Panel de administración de tu grupo.
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

          {/* The conditional section shows once config is resolved.
              widgetUsername is set by Effect 1 when the domain matches;
              tgFallbackUrl is set when we're on the wrong domain.
              The widget container div (ref={widgetRef}) lives here so it is
              in the DOM when Effect 2 runs, giving it a non-null ref to inject into. */}
          {(widgetUsername !== null || tgFallbackUrl !== null) && (
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

              {/* Widget container — rendered here (inside the conditional) so widgetRef
                  is populated at the time Effect 2 runs (after this render completes).
                  display:none collapses it until the Telegram script renders the button. */}
              <div
                ref={widgetRef}
                style={{ display: tgEnabled ? "flex" : "none", justifyContent: "center" }}
              />

              {!widgetUsername && tgFallbackUrl && (
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
