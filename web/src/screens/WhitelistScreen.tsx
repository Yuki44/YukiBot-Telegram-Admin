import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { SpamDetectionCard } from "../components/SpamDetectionCard";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { avClass, initials } from "../lib/utils";
import type { SpamDetection, UserDomainAllowance } from "../types/api";

type Tab = "recent" | "links" | "users" | "combo";

interface AddPanelProps {
  placeholder: string;
  helpText: ReactNode;
  inputMode?: "text" | "numeric";
  validate: (raw: string) => string | null;
  onSubmit: (value: string) => Promise<void>;
}

function AddPanel({ placeholder, helpText, inputMode = "text", validate, onSubmit }: AddPanelProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const err = validate(value);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      setValue("");
    } catch (apiErr) {
      setError(apiErr instanceof Error ? apiErr.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="yk-card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="yk-input"
          inputMode={inputMode}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="yk-btn"
          disabled={busy}
          style={{ width: "auto", padding: "12px 18px" }}
        >
          {busy ? "…" : I.plus({ size: 18 })}
        </button>
      </div>
      <div className="yk-help" style={{ marginTop: 8 }}>
        {helpText}
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            background: "var(--danger-bg)",
            color: "var(--danger-fg)",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}

interface ListRowProps {
  label: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  onRemove: () => void;
  removing: boolean;
}

function ListRow({ label, sub, icon, onRemove, removing }: ListRowProps) {
  return (
    <div className="yk-row" style={{ cursor: "default" }}>
      <div className="yk-row-icon">{icon}</div>
      <div className="yk-row-body">
        <div className="yk-row-title">{label}</div>
        {sub && <div className="yk-row-sub">{sub}</div>}
      </div>
      <div className="yk-row-trail">
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label="Eliminar"
          style={{
            background: "transparent",
            border: 0,
            cursor: removing ? "default" : "pointer",
            padding: 6,
            color: "var(--danger-fg)",
            opacity: removing ? 0.4 : 1,
          }}
        >
          {I.trash({ size: 18 })}
        </button>
      </div>
    </div>
  );
}

export function WhitelistScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [tab, setTab] = useState<Tab>("recent");

  const [links, setLinks] = useState<string[] | null>(null);
  const [users, setUsers] = useState<number[] | null>(null);
  const [combo, setCombo] = useState<UserDomainAllowance[] | null>(null);
  const [recent, setRecent] = useState<SpamDetection[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comboNewUserId, setComboNewUserId] = useState("");
  const [comboNewDomain, setComboNewDomain] = useState("");
  const [comboCreating, setComboCreating] = useState(false);
  const [comboError, setComboError] = useState<string | null>(null);

  function handleApiErr(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      navigate("/login", { replace: true });
      return;
    }
    setError(err instanceof Error ? err.message : "error");
  }

  useEffect(() => {
    if (!chatId) return;
    setError(null);
    if (tab === "recent" && recent === null) {
      api.spamDetections.list(chatId).then(setRecent).catch(handleApiErr);
    }
    if (tab === "links" && links === null) {
      api.whitelist.listLinks(chatId).then(setLinks).catch(handleApiErr);
    }
    if (tab === "users" && users === null) {
      api.whitelist.listUsers(chatId).then(setUsers).catch(handleApiErr);
    }
    if (tab === "combo" && combo === null) {
      api.whitelist.listCombo(chatId).then(setCombo).catch(handleApiErr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, tab]);

  async function permitDetection(patternId: string) {
    if (!chatId) return;
    try {
      const result = await api.spamDetections.permit(chatId, patternId);
      setRecent((prev) => prev?.filter((d) => d.patternId !== patternId) ?? prev);
      // The permit just changed one of the other whitelists — invalidate so the
      // user sees the new entry if they switch tabs.
      if (result.kind === "link") setLinks(null);
      else setUsers(null);
    } catch (err) {
      handleApiErr(err);
    }
  }

  async function discardDetection(patternId: string) {
    if (!chatId) return;
    try {
      await api.spamDetections.discard(chatId, patternId);
      setRecent((prev) => prev?.filter((d) => d.patternId !== patternId) ?? prev);
    } catch (err) {
      handleApiErr(err);
    }
  }

  async function addLink(value: string) {
    if (!chatId) return;
    const updated = await api.whitelist.addLink(chatId, value);
    setLinks(updated);
  }
  async function removeLink(domain: string) {
    if (!chatId) return;
    setRemoving("link:" + domain);
    try {
      const updated = await api.whitelist.removeLink(chatId, domain);
      setLinks(updated);
    } catch (err) {
      handleApiErr(err);
    } finally {
      setRemoving(null);
    }
  }
  async function addUser(value: string) {
    if (!chatId) return;
    const userId = Number(value);
    const updated = await api.whitelist.addUser(chatId, userId);
    setUsers(updated);
  }
  async function removeUser(uid: number) {
    if (!chatId) return;
    setRemoving("user:" + uid);
    try {
      const updated = await api.whitelist.removeUser(chatId, uid);
      setUsers(updated);
    } catch (err) {
      handleApiErr(err);
    } finally {
      setRemoving(null);
    }
  }

  async function comboAddDomain(uid: number, domain: string) {
    if (!chatId) return;
    const updated = await api.whitelist.addComboDomain(chatId, uid, domain);
    setCombo((prev) => {
      if (!prev) return prev;
      const idx = prev.findIndex((c) => c.userId === uid);
      if (idx === -1) {
        return [...prev, { userId: uid, chatId: Number(chatId), domains: updated.domains, name: null, username: null }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], domains: updated.domains };
      return next;
    });
  }

  async function comboRemoveDomain(uid: number, domain: string) {
    if (!chatId) return;
    setRemoving(`combo:${uid}:${domain}`);
    try {
      const updated = await api.whitelist.removeComboDomain(chatId, uid, domain);
      setCombo((prev) => {
        if (!prev) return prev;
        if (updated.domains.length === 0) {
          return prev.filter((c) => c.userId !== uid);
        }
        return prev.map((c) => (c.userId === uid ? { ...c, domains: updated.domains } : c));
      });
    } catch (err) {
      handleApiErr(err);
    } finally {
      setRemoving(null);
    }
  }

  async function comboCreatePermission(e: React.FormEvent) {
    e.preventDefault();
    if (!chatId || comboCreating) return;
    setComboError(null);
    const uid = Number(comboNewUserId);
    if (!Number.isFinite(uid) || uid <= 0) {
      setComboError("ID de usuario inválido.");
      return;
    }
    if (comboNewDomain.trim().length < 3) {
      setComboError("Dominio demasiado corto.");
      return;
    }
    setComboCreating(true);
    try {
      await comboAddDomain(uid, comboNewDomain.trim());
      setComboNewUserId("");
      setComboNewDomain("");
    } catch (err) {
      setComboError(err instanceof Error ? err.message : "error");
    } finally {
      setComboCreating(false);
    }
  }

  const titleSuffix = chat ? ` · ${chat.name}` : "";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Permitidos${titleSuffix}`}
        onBack={() => navigate(`/chats/${chatId}`)}
      />

      <div className="yk-segmented">
        <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
          Recientes
        </button>
        <button className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}>
          Enlaces
        </button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          Usuarios
        </button>
        <button className={tab === "combo" ? "active" : ""} onClick={() => setTab("combo")}>
          Mixtos
        </button>
      </div>

      <div className="yk-scroll yk-pad-nav">
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

        {tab === "recent" && (
          <>
            <div style={{ padding: "8px 16px 16px" }}>
              <div className="yk-banner" style={{ margin: 0 }}>
                {I.help({ size: 18 })}
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Detecciones recientes</div>
                  Cada vez que un admin usa <code>/spam</code>, el patrón aprendido aparece aquí.
                  Toca <b>Permitir</b> si fue un falso positivo o <b>Descartar</b> para sacarlo de
                  la bandeja (la regla aprendida se mantiene).
                </div>
              </div>
            </div>

            <div className="yk-section">
              {recent === null ? (
                <div className="yk-card">
                  <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
                </div>
              ) : recent.length === 0 ? (
                <div className="yk-card">
                  <div className="yk-empty">
                    <div className="yk-empty-icon">{I.shield({ size: 28 })}</div>
                    <div className="yk-empty-title">Sin detecciones recientes</div>
                    <div>Cuando YukiBot marque un mensaje, aparecerá aquí.</div>
                  </div>
                </div>
              ) : (
                recent.map((d) => (
                  <SpamDetectionCard
                    key={d.patternId}
                    detection={d}
                    onPermit={permitDetection}
                    onDiscard={discardDetection}
                    onOpenProfile={(uid) => navigate(`/chats/${chatId}/users/${uid}`)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {tab === "links" && (
          <>
            <div style={{ padding: "8px 16px 16px" }}>
              <div className="yk-banner" style={{ margin: 0 }}>
                {I.help({ size: 18 })}
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Enlaces siempre permitidos</div>
                  Estos dominios se libran de la detección de spam. Funciona con o sin{" "}
                  <code>www.</code> y con o sin <code>https://</code>.
                </div>
              </div>
            </div>

            <div className="yk-section">
              <AddPanel
                placeholder="ejemplo.com"
                helpText="Acepta dominios completos. El bot normaliza la entrada."
                validate={(raw) => {
                  const trimmed = raw.trim();
                  if (trimmed.length < 3) return "Dominio demasiado corto.";
                  return null;
                }}
                onSubmit={addLink}
              />
            </div>

            <div className="yk-section">
              <div className="yk-section-label">DOMINIOS PERMITIDOS</div>
              <div className="yk-card">
                {links === null ? (
                  <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
                ) : links.length === 0 ? (
                  <div className="yk-empty">
                    <div className="yk-empty-icon">{I.link({ size: 28 })}</div>
                    <div className="yk-empty-title">Sin dominios</div>
                    <div>Añade el primero arriba.</div>
                  </div>
                ) : (
                  links.map((d) => (
                    <ListRow
                      key={d}
                      icon={I.link({ size: 20 })}
                      label={
                        <span
                          className="yk-mono"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {d}
                        </span>
                      }
                      onRemove={() => removeLink(d)}
                      removing={removing === "link:" + d}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {tab === "users" && (
          <>
            <div style={{ padding: "8px 16px 16px" }}>
              <div className="yk-banner" style={{ margin: 0 }}>
                {I.help({ size: 18 })}
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Usuarios sin filtros</div>
                  Estos usuarios pueden enviar enlaces y promos sin que YukiBot los marque como
                  spam. Útil para colaboradores o cuentas oficiales del grupo.
                </div>
              </div>
            </div>

            <div className="yk-section">
              <AddPanel
                placeholder="123456789"
                helpText="Pega el ID numérico de Telegram. Lo encuentras en la pantalla del usuario."
                inputMode="numeric"
                validate={(raw) => {
                  const n = Number(raw);
                  if (!Number.isFinite(n) || n <= 0) return "ID inválido.";
                  return null;
                }}
                onSubmit={addUser}
              />
            </div>

            <div className="yk-section">
              <div className="yk-section-label">USUARIOS PERMITIDOS</div>
              <div className="yk-card">
                {users === null ? (
                  <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
                ) : users.length === 0 ? (
                  <div className="yk-empty">
                    <div className="yk-empty-icon">{I.user({ size: 28 })}</div>
                    <div className="yk-empty-title">Sin usuarios</div>
                    <div>Añade el primero arriba.</div>
                  </div>
                ) : (
                  users.map((uid) => (
                    <ListRow
                      key={uid}
                      icon={I.user({ size: 20 })}
                      label={
                        <span
                          className="yk-mono"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          ID {uid}
                        </span>
                      }
                      sub={
                        <button
                          type="button"
                          onClick={() => navigate(`/chats/${chatId}/users/${uid}`)}
                          style={{
                            background: "transparent",
                            border: 0,
                            color: "var(--brand-700)",
                            cursor: "pointer",
                            padding: 0,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          Ver perfil →
                        </button>
                      }
                      onRemove={() => removeUser(uid)}
                      removing={removing === "user:" + uid}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {tab === "combo" && (
          <>
            <div style={{ padding: "8px 16px 16px" }}>
              <div className="yk-banner" style={{ margin: 0 }}>
                {I.shield({ size: 18 })}
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Permisos mixtos</div>
                  Estos usuarios pueden compartir <i>solo</i> los dominios listados, aunque no
                  estén en la whitelist general. Útil para bots de noticias o cuentas que solo
                  comparten un sitio concreto.
                </div>
              </div>
            </div>

            <div className="yk-section">
              <form
                onSubmit={comboCreatePermission}
                className="yk-card"
                style={{ padding: 14, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div className="yk-field" style={{ marginBottom: 0 }}>
                  <label className="yk-label">ID del usuario</label>
                  <input
                    className="yk-input"
                    inputMode="numeric"
                    value={comboNewUserId}
                    onChange={(e) => setComboNewUserId(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456789"
                    disabled={comboCreating}
                  />
                </div>
                <div className="yk-field" style={{ marginBottom: 0 }}>
                  <label className="yk-label">Primer dominio permitido</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="yk-input"
                      value={comboNewDomain}
                      onChange={(e) => setComboNewDomain(e.target.value)}
                      placeholder="behance.net"
                      disabled={comboCreating}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="yk-btn"
                      disabled={comboCreating}
                      style={{ width: "auto", padding: "12px 18px" }}
                    >
                      {comboCreating ? "…" : "Crear"}
                    </button>
                  </div>
                  <div className="yk-help" style={{ marginTop: 8 }}>
                    Podrás añadir más dominios desde la tarjeta del usuario.
                  </div>
                </div>
                {comboError && (
                  <div
                    role="alert"
                    style={{
                      background: "var(--danger-bg)",
                      color: "var(--danger-fg)",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {comboError}
                  </div>
                )}
              </form>
            </div>

            <div className="yk-section">
              <div className="yk-section-label">PERMISOS ACTIVOS</div>
              {combo === null ? (
                <div className="yk-card">
                  <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
                </div>
              ) : combo.length === 0 ? (
                <div className="yk-card">
                  <div className="yk-empty">
                    <div className="yk-empty-icon">{I.shield({ size: 28 })}</div>
                    <div className="yk-empty-title">Sin permisos mixtos</div>
                    <div>Crea el primero arriba.</div>
                  </div>
                </div>
              ) : (
                combo.map((entry) => {
                  const display =
                    entry.name?.trim() ||
                    entry.username?.trim() ||
                    `ID ${entry.userId}`;
                  return (
                    <div
                      key={entry.userId}
                      className="yk-card"
                      style={{ padding: 16, marginBottom: 10 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div className={`yk-avatar ${avClass(display)}`}>
                          {entry.name || entry.username ? initials(display) : "?"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>{display}</div>
                          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
                            {entry.username
                              ? `@${entry.username.replace(/^@/, "")}`
                              : `ID ${entry.userId}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate(`/chats/${chatId}/users/${entry.userId}`)}
                          aria-label="Ver perfil"
                          style={{
                            background: "transparent",
                            border: 0,
                            cursor: "pointer",
                            padding: 6,
                            color: "var(--brand-700)",
                          }}
                        >
                          {I.chevR()}
                        </button>
                      </div>
                      <div className="yk-pill-grid">
                        {entry.domains.map((d) => (
                          <span
                            key={d}
                            className="yk-pill on yk-mono"
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              opacity: removing === `combo:${entry.userId}:${d}` ? 0.4 : 1,
                            }}
                          >
                            {I.link({ size: 12 })}
                            {d}
                            <button
                              type="button"
                              onClick={() => comboRemoveDomain(entry.userId, d)}
                              disabled={removing === `combo:${entry.userId}:${d}`}
                              aria-label={`Quitar ${d}`}
                              style={{
                                background: "transparent",
                                border: 0,
                                padding: 0,
                                marginLeft: 4,
                                cursor: "pointer",
                                color: "inherit",
                                display: "inline-flex",
                              }}
                            >
                              {I.close({ size: 12 })}
                            </button>
                          </span>
                        ))}
                        <ComboAddPill onAdd={(d) => comboAddDomain(entry.userId, d)} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface ComboAddPillProps {
  onAdd: (domain: string) => Promise<void>;
}

function ComboAddPill({ onAdd }: ComboAddPillProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (value.trim().length < 3) return;
    setBusy(true);
    try {
      await onAdd(value.trim());
      setValue("");
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" className="yk-pill" onClick={() => setEditing(true)}>
        {I.plus({ size: 12 })} añadir
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "inline-flex", gap: 4 }}>
      <input
        autoFocus
        className="yk-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="dominio.com"
        disabled={busy}
        style={{ width: 140, padding: "4px 8px", fontSize: 12 }}
      />
      <button
        type="submit"
        className="yk-pill on"
        disabled={busy}
        style={{ cursor: "pointer" }}
      >
        {I.check({ size: 12 })}
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setValue("");
        }}
        className="yk-pill"
        style={{ cursor: "pointer" }}
      >
        {I.close({ size: 12 })}
      </button>
    </form>
  );
}
