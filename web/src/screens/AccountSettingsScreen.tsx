import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession, getStoredUser } from "../lib/auth";
import { avClass, initials } from "../lib/utils";

const NOTIF_KEY = "yk_notif_pref";

function readNotifPref(): boolean {
  return localStorage.getItem(NOTIF_KEY) !== "off";
}

function writeNotifPref(on: boolean): void {
  localStorage.setItem(NOTIF_KEY, on ? "on" : "off");
}

export function AccountSettingsScreen() {
  const navigate = useNavigate();
  const me = getStoredUser();
  const [notif, setNotif] = useState<boolean>(readNotifPref);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwToast, setPwToast] = useState<string | null>(null);

  useEffect(() => {
    writeNotifPref(notif);
  }, [notif]);

  useEffect(() => {
    if (!pwToast) return;
    const t = setTimeout(() => setPwToast(null), 2800);
    return () => clearTimeout(t);
  }, [pwToast]);

  function logout() {
    clearSession();
    // Hard navigation (not React Router) so the Telegram widget script is reloaded
    // fresh on the login screen — otherwise the previous mount's iframe state can
    // leave the widget in a half-rendered state after a Telegram-auth session.
    window.location.replace("/login");
  }

  if (!me) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title="Ajustes" onBack={() => navigate("/chats")} />
        <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
      </div>
    );
  }

  const displayName = me.name?.trim() || me.username || `ID ${me.userId}`;
  const handle = me.username ? `@${me.username.replace(/^@/, "")}` : `ID ${me.userId}`;
  const roleLabel = me.isSuperAdmin ? "Super-admin" : "Admin";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title="Ajustes" onBack={() => navigate("/chats")} />

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 16px 16px" }}>
          <div
            className="yk-card"
            style={{ padding: 18, display: "flex", gap: 14, alignItems: "center" }}
          >
            <div
              className={`yk-avatar ${avClass(displayName)}`}
              style={{ width: 56, height: 56, fontSize: 20, borderRadius: 18 }}
            >
              {initials(displayName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{displayName}</div>
              <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
                {handle} · {roleLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="yk-section">
          <div className="yk-section-label">CUENTA</div>
          <div className="yk-card">
            {me.hasCredential ? (
              <button type="button" className="yk-row" onClick={() => setPwOpen(true)}>
                <div className="yk-row-icon">{I.lock({ size: 20 })}</div>
                <div className="yk-row-body">
                  <div className="yk-row-title">Cambiar contraseña</div>
                  <div className="yk-row-sub">Mínimo 8 caracteres</div>
                </div>
                {I.chevR()}
              </button>
            ) : (
              <div className="yk-row" style={{ cursor: "default", opacity: 0.55 }} aria-disabled="true">
                <div className="yk-row-icon">{I.lock({ size: 20 })}</div>
                <div className="yk-row-body">
                  <div className="yk-row-title">Cambiar contraseña</div>
                  <div className="yk-row-sub">
                    Esta cuenta solo se autentica por Telegram. Pídele al propietario que cree una
                    contraseña para poder cambiarla.
                  </div>
                </div>
              </div>
            )}
            <div className="yk-row" style={{ cursor: "default" }}>
              <div className="yk-row-icon info">{I.telegram({ size: 20 })}</div>
              <div className="yk-row-body">
                <div className="yk-row-title">Conectar Telegram</div>
                <div className="yk-row-sub">Vinculado: {handle}</div>
              </div>
              <span className="yk-chip ok">Conectado</span>
            </div>
            <button
              type="button"
              className="yk-row"
              onClick={() => setNotif((v) => !v)}
              aria-pressed={notif}
            >
              <div className="yk-row-icon warm">{I.bell({ size: 20 })}</div>
              <div className="yk-row-body">
                <div className="yk-row-title">Notificaciones</div>
                <div className="yk-row-sub">Avisos importantes en este dispositivo</div>
              </div>
              <div className={`yk-switch${notif ? " on" : ""}`} />
            </button>
          </div>
          <div className="yk-help" style={{ padding: "8px 8px 0" }}>
            La preferencia de notificaciones se guarda solo en este navegador.
          </div>
        </div>

        <div className="yk-section">
          <div className="yk-card">
            <button type="button" className="yk-row" onClick={logout}>
              <div className="yk-row-icon danger">{I.logout({ size: 20 })}</div>
              <div className="yk-row-body">
                <div className="yk-row-title" style={{ color: "var(--danger-fg)" }}>
                  Cerrar sesión
                </div>
              </div>
            </button>
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            color: "var(--ink-400)",
            fontSize: 12,
            padding: "8px 16px 24px",
          }}
        >
          YukiBot v2.0.0 · Hecho con cariño ❤️
        </div>
      </div>

      {pwOpen && (
        <PasswordChangeSheet
          onClose={() => setPwOpen(false)}
          onSuccess={() => {
            setPwOpen(false);
            setPwToast("Contraseña actualizada");
          }}
        />
      )}

      {pwToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 88,
            transform: "translateX(-50%)",
            background: "var(--ok-fg)",
            color: "white",
            padding: "10px 16px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            zIndex: 60,
          }}
        >
          {pwToast}
        </div>
      )}
    </div>
  );
}

interface PasswordChangeSheetProps {
  onClose: () => void;
  onSuccess: () => void;
}

function PasswordChangeSheet({ onClose, onSuccess }: PasswordChangeSheetProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!current || !next || !confirm) {
      setError("Rellena los tres campos.");
      return;
    }
    if (next.length < 8) {
      setError("La nueva contraseña necesita al menos 8 caracteres.");
      return;
    }
    if (next !== confirm) {
      setError("La confirmación no coincide.");
      return;
    }
    if (next === current) {
      setError("La nueva contraseña debe ser distinta de la actual.");
      return;
    }
    setBusy(true);
    try {
      await api.auth.changePassword(current, next);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_current_password")
          setError("La contraseña actual no es correcta.");
        else if (err.code === "weak_password")
          setError("La nueva contraseña necesita al menos 8 caracteres.");
        else if (err.code === "no_credential")
          setError(
            "Esta cuenta no tiene contraseña. Inicia sesión con Telegram o pídele al propietario que cree una."
          );
        else setError("No se pudo cambiar la contraseña. " + err.code);
      } else {
        setError("No se pudo cambiar la contraseña.");
      }
      setBusy(false);
    }
  }

  return (
    <div className="yk-sheet-overlay" onClick={onClose}>
      <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yk-sheet-handle" />
        <form onSubmit={submit} style={{ padding: "8px 20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div className="yk-row-icon">{I.lock({ size: 20 })}</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Cambiar contraseña</div>
          </div>

          <div className="yk-field" style={{ marginBottom: 12 }}>
            <label className="yk-label" htmlFor="pw-current">Contraseña actual</label>
            <div className="yk-input-wrap">
              <span className="yk-input-icon">{I.lock({ size: 18 })}</span>
              <input
                id="pw-current"
                className="yk-input with-icon"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Ocultar" : "Mostrar"}
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
                {showCurrent ? I.eyeOff({ size: 18 }) : I.eye({ size: 18 })}
              </button>
            </div>
          </div>

          <div className="yk-field" style={{ marginBottom: 12 }}>
            <label className="yk-label" htmlFor="pw-new">Nueva contraseña</label>
            <div className="yk-input-wrap">
              <span className="yk-input-icon">{I.lock({ size: 18 })}</span>
              <input
                id="pw-new"
                className="yk-input with-icon"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                aria-label={showNext ? "Ocultar" : "Mostrar"}
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
                {showNext ? I.eyeOff({ size: 18 }) : I.eye({ size: 18 })}
              </button>
            </div>
          </div>

          <div className="yk-field" style={{ marginBottom: 12 }}>
            <label className="yk-label" htmlFor="pw-confirm">Confirmar nueva contraseña</label>
            <div className="yk-input-wrap">
              <span className="yk-input-icon">{I.lock({ size: 18 })}</span>
              <input
                id="pw-confirm"
                className="yk-input with-icon"
                type={showNext ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

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

          <button type="submit" className="yk-btn" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Guardando…" : "Guardar contraseña"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              marginTop: 8,
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
        </form>
      </div>
    </div>
  );
}
