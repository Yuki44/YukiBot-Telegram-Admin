import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { IdentitySubline } from "../components/IdentitySubline";
import { UserAvatar } from "../components/UserAvatar";
import { ApiError, api } from "../lib/api";
import { clearSession, getStoredUser } from "../lib/auth";
import { useChat } from "../lib/useChat";
import type { AdminRecord, AdminsResponse } from "../types/api";

/**
 * Defensive identity resolver — Telegram occasionally returns admins with no
 * first_name / last_name (anonymous group admins, deleted accounts), which
 * /setup persists as name="Unknown" + empty username. Render those cases as an
 * italic fallback instead of a blank row.
 */
function adminIdentity(a: AdminRecord): { primary: React.ReactNode; secondary: React.ReactNode } {
  const name = a.name?.trim();
  const username = a.username?.trim() || null;
  const subline = <IdentitySubline username={username} userId={a.userId} />;
  if (name && name.toLowerCase() !== "unknown") {
    return { primary: name, secondary: subline };
  }
  if (username) {
    return { primary: `@${username.replace(/^@/, "")}`, secondary: subline };
  }
  return {
    primary: (
      <span style={{ color: "var(--ink-500)", fontStyle: "italic" }}>
        Admin sin nombre
      </span>
    ),
    secondary: subline,
  };
}

function roleChip(a: AdminRecord) {
  if (a.telegramRole === "owner") {
    return (
      <span className="yk-chip" title="Propietario en Telegram">
        {I.star({ size: 12 })} Propietario (Telegram)
      </span>
    );
  }
  if (a.isDelegatedOwner) {
    return (
      <span className="yk-chip brand">
        {I.star({ size: 12 })} Propietario delegado
      </span>
    );
  }
  return <span className="yk-chip">Admin</span>;
}

export function AdminsScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const me = getStoredUser();

  const [data, setData] = useState<AdminsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  function handleErr(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      navigate("/login", { replace: true });
      return;
    }
    setError(err instanceof Error ? err.message : "error");
  }

  useEffect(() => {
    if (!chatId) return;
    api.admins.list(chatId).then(setData).catch(handleErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  async function delegate(userId: number) {
    if (!chatId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.admins.delegate(chatId, userId);
      const fresh = await api.admins.list(chatId);
      setData(fresh);
      setShowSheet(false);
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!chatId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.admins.revoke(chatId);
      const fresh = await api.admins.list(chatId);
      setData(fresh);
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(userId: number, currentlyHidden: boolean) {
    if (!chatId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.admins.setVisibility(chatId, userId, !currentlyHidden);
      const fresh = await api.admins.list(chatId);
      setData(fresh);
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  }

  const titleSuffix = chat ? ` · ${chat.name}` : "";

  // Did the logged-in user land here as the Telegram chat creator?
  // That's the only role that may grant or revoke owner delegation.
  const meRecord = data?.admins.find((a) => a.userId === me?.userId) ?? null;
  const canDelegate = meRecord?.telegramRole === "owner" || me?.isSuperAdmin === true;

  const delegatedAdmin =
    data && data.delegatedOwnerId !== null
      ? data.admins.find((a) => a.userId === data.delegatedOwnerId) ?? null
      : null;

  // Sheet candidates: every admin who isn't the Telegram creator (delegating to them is meaningless).
  const candidates = (data?.admins ?? []).filter((a) => a.telegramRole !== "owner");

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Equipo de admins${titleSuffix}`}
        onBack={() => navigate(`/chats/${chatId}`)}
      />

      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>
            Solo el <b>propietario</b> puede añadir o quitar admins. Los admins moderan pero no
            pueden cambiar funciones del bot.
          </div>
        </div>

        {error && (
          <div className="yk-section">
            <div
              className="yk-banner"
              style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}
              role="alert"
            >
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        )}

        {canDelegate && data && (
          <div style={{ padding: "0 16px 12px" }}>
            <div
              className="yk-card"
              style={{
                padding: 16,
                borderColor: "var(--brand-200)",
                background: "var(--brand-50)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {I.star({ size: 18 })}
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--brand-700)" }}>
                  Delegar permisos de propietario
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-700)",
                  lineHeight: 1.5,
                  marginBottom: 12,
                }}
              >
                Tu cuenta figura como creadora del chat en Telegram. Puedes ceder los permisos de
                propietario <b>dentro de YukiBot</b> a una de las cuentas admin para gestionar el
                bot desde ella.
              </div>
              {delegatedAdmin ? (
                (() => {
                  const did = adminIdentity(delegatedAdmin);
                  return (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: "var(--bg-card)",
                    border: "1px solid var(--ink-100)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <UserAvatar
                    name={delegatedAdmin.name?.trim() && delegatedAdmin.name.trim().toLowerCase() !== "unknown" ? delegatedAdmin.name : delegatedAdmin.username || ""}
                    photoFileId={delegatedAdmin.photoFileId}
                    size={36}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{did.primary}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                      {did.secondary} · actúa como propietario
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={revoke}
                    disabled={busy}
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor: busy ? "default" : "pointer",
                      color: "var(--danger-fg)",
                      fontWeight: 700,
                      fontSize: 13,
                      padding: "6px 10px",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Revocar
                  </button>
                </div>
                  );
                })()
              ) : (
                <button
                  type="button"
                  className="yk-btn"
                  onClick={() => setShowSheet(true)}
                  disabled={busy || candidates.length === 0}
                >
                  {I.plus({ size: 18 })} Elegir cuenta delegada
                </button>
              )}
              {!delegatedAdmin && candidates.length === 0 && (
                <div
                  className="yk-help"
                  style={{ marginTop: 10, color: "var(--ink-500)" }}
                >
                  Aún no hay admins en el chat. Añade alguno desde Telegram para poder delegar.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="yk-section">
          <div className="yk-section-label">PERSONAS</div>
          <div className="yk-card">
            {data === null ? (
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            ) : data.admins.length === 0 ? (
              <div className="yk-empty">
                <div className="yk-empty-icon">{I.users({ size: 28 })}</div>
                <div className="yk-empty-title">Sin admins registrados</div>
                <div>YukiBot sincroniza la lista cuando entra al grupo.</div>
              </div>
            ) : (
              data.admins.map((a) => {
                const isMe = a.userId === me?.userId;
                const canToggleSelf =
                  isMe && (a.telegramRole === "owner" || me?.isSuperAdmin === true);
                const id = adminIdentity(a);
                return (
                  <div key={a.userId} className="yk-row" style={{ cursor: "default" }}>
                    <UserAvatar
                      name={a.name?.trim() && a.name.trim().toLowerCase() !== "unknown" ? a.name : a.username || ""}
                      photoFileId={a.photoFileId}
                    />
                    <div className="yk-row-body">
                      <div
                        className="yk-row-title"
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                      >
                        {id.primary}
                        {a.hiddenInAdminList && (
                          <span
                            title="Oculto en la lista de admins"
                            style={{ display: "inline-flex", color: "var(--ink-400)" }}
                          >
                            {I.eyeOff({ size: 14 })}
                          </span>
                        )}
                      </div>
                      <div className="yk-row-sub">
                        {id.secondary}
                        {isMe && " · tú"}
                        {a.hiddenInAdminList && " · oculto en la lista del chat"}
                      </div>
                    </div>
                    <div className="yk-row-trail" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {canToggleSelf && (
                        <button
                          type="button"
                          onClick={() => toggleVisibility(a.userId, a.hiddenInAdminList)}
                          disabled={busy}
                          aria-label={a.hiddenInAdminList ? "Mostrarme" : "Ocultarme"}
                          title={a.hiddenInAdminList ? "Mostrarme en la lista" : "Ocultarme de la lista"}
                          style={{
                            background: "transparent",
                            border: 0,
                            cursor: busy ? "default" : "pointer",
                            color: "var(--ink-500)",
                            padding: 6,
                            opacity: busy ? 0.5 : 1,
                          }}
                        >
                          {a.hiddenInAdminList
                            ? I.eye({ size: 18 })
                            : I.eyeOff({ size: 18 })}
                        </button>
                      )}
                      {roleChip(a)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="yk-help" style={{ padding: "8px 8px 0" }}>
            La delegación solo afecta a los permisos dentro de YukiBot. El propietario en Telegram
            sigue siendo la cuenta que creó el chat.
          </div>
        </div>
      </div>

      {showSheet && (
        <div
          className="yk-sheet-overlay"
          onClick={() => !busy && setShowSheet(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="yk-sheet-handle" />
            <div className="yk-sheet-title">Delegar a una cuenta admin</div>
            <div className="yk-sheet-body">
              <div style={{ color: "var(--ink-500)", fontSize: 14, marginBottom: 14 }}>
                Esa cuenta podrá gestionar admins, funciones del bot y cualquier otro ajuste de
                propietario. Puedes revocar la delegación en cualquier momento.
              </div>
              {candidates.map((a) => {
                const cid = adminIdentity(a);
                return (
                <button
                  key={a.userId}
                  type="button"
                  className="yk-row"
                  onClick={() => delegate(a.userId)}
                  disabled={busy}
                  style={{
                    border: "1px solid var(--ink-100)",
                    borderRadius: 14,
                    marginBottom: 8,
                    padding: "12px 14px",
                    width: "100%",
                    background: "var(--bg-card)",
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  <UserAvatar
                    name={a.name?.trim() && a.name.trim().toLowerCase() !== "unknown" ? a.name : a.username || ""}
                    photoFileId={a.photoFileId}
                  />
                  <div className="yk-row-body">
                    <div className="yk-row-title">{cid.primary}</div>
                    <div className="yk-row-sub">{cid.secondary}</div>
                  </div>
                  {I.chevR()}
                </button>
              );
              })}
              <button
                type="button"
                className="yk-btn ghost"
                onClick={() => setShowSheet(false)}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
