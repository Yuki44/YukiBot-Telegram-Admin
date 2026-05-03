import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { YukiLogo } from "../components/YukiLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { api } from "../lib/api";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.onTelegramAuth = async (user: TelegramAuthData) => {
      setBusy(true);
      setError(null);
      try {
        const { token, user: authUser } = await api.auth.telegram(user);
        saveSession(token, authUser);
        navigate("/chats", { replace: true });
      } catch (err) {
        const code = err instanceof Error ? err.message : "error";
        if (code.includes("403")) setError("No tienes permisos de admin en ningún chat.");
        else if (code.includes("401")) setError("Firma de Telegram inválida o expirada. Intenta de nuevo.");
        else setError("No se pudo iniciar sesión. " + code);
        setBusy(false);
      }
    };

    api
      .publicConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg.botUsername) {
          setError("BOT_USERNAME no está configurado en el servidor.");
          return;
        }
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-widget.js?22";
        script.async = true;
        script.setAttribute("data-telegram-login", cfg.botUsername);
        script.setAttribute("data-size", "large");
        script.setAttribute("data-radius", "12");
        script.setAttribute("data-onauth", "onTelegramAuth(user)");
        script.setAttribute("data-request-access", "write");
        widgetRef.current?.appendChild(script);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la configuración del servidor.");
      });

    return () => {
      cancelled = true;
      delete window.onTelegramAuth;
    };
  }, [navigate]);

  return (
    <div className="yk" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", top: 12, right: 12 }}>
        <ThemeToggle />
      </div>
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

      <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <p style={{ color: "var(--ink-500)", fontSize: 14, textAlign: "center", margin: 0 }}>
          Inicia sesión con tu cuenta de Telegram. Solo los administradores registrados pueden entrar.
        </p>

        <div ref={widgetRef} style={{ minHeight: 48 }} />

        {busy && <div style={{ color: "var(--ink-500)", fontSize: 13 }}>Verificando…</div>}

        {error && (
          <div
            role="alert"
            style={{
              background: "var(--danger-50, #fee2e2)",
              color: "var(--danger-700, #b91c1c)",
              padding: "10px 14px",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              maxWidth: 360,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "var(--ink-500)" }}>
          ¿No tienes acceso? Pídelo al admin del grupo.
        </div>
      </div>
    </div>
  );
}
