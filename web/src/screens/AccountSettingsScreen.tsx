import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
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

  useEffect(() => {
    writeNotifPref(notif);
  }, [notif]);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
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
            <button type="button" className="yk-row" onClick={() => setPwOpen(true)}>
              <div className="yk-row-icon">{I.lock({ size: 20 })}</div>
              <div className="yk-row-body">
                <div className="yk-row-title">Cambiar contraseña</div>
                <div className="yk-row-sub">Próximamente · pídele al propietario un reseteo</div>
              </div>
              {I.chevR()}
            </button>
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
          YukiBot v{__APP_VERSION__} · Hecho con cariño
        </div>
      </div>

      {pwOpen && (
        <div className="yk-sheet-overlay" onClick={() => setPwOpen(false)}>
          <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="yk-sheet-handle" />
            <div style={{ padding: "8px 20px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div className="yk-row-icon">{I.lock({ size: 20 })}</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>Cambiar contraseña</div>
              </div>
              <div style={{ color: "var(--ink-500)", fontSize: 14, marginBottom: 16 }}>
                El cambio de contraseña desde la app aún no está disponible. Mientras tanto,
                pídele al propietario del grupo que la restablezca por ti — puede hacerlo desde
                su panel de administración.
              </div>
              <button type="button" className="yk-btn" onClick={() => setPwOpen(false)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
