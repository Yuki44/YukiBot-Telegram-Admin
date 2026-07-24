import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { SlideToConfirm } from "../components/SlideToConfirm";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { invalidateChat } from "../lib/useChat";
import type {
  ChatDetail,
  ChatSummary,
  DeduplicateResult,
  MigrationSelection,
  MigrationSummary,
} from "../types/api";

type Phase = "input" | "loading" | "done";
type SourceMode = "dropdown" | "manual";
type UsersMode = "all" | "bansOnly";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mapError(err: unknown, sourceChatId: number): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Solo el propietario de este chat puede migrar datos.";
    if (err.code === "source_not_found")
      return `No se encontró el chat de origen (${sourceChatId}).`;
    if (err.code === "dest_not_found")
      return "Este chat aún no está inicializado. Ejecuta /setup primero.";
    if (err.code === "invalid_source") return "El ID del chat de origen no es válido.";
    if (err.code === "nothing_selected")
      return "Selecciona al menos una categoría para migrar.";
  }
  return err instanceof Error ? err.message : "Error inesperado.";
}

export function MigrationScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ChatDetail | null>(null);

  // Source picker — list every chat the caller can see (same data as the sidebar),
  // minus this destination chat.
  const [sources, setSources] = useState<ChatSummary[] | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("dropdown");
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sourceInput, setSourceInput] = useState("");

  // Dedupe tool (separate from the migration form).
  const [dedupeResetKey, setDedupeResetKey] = useState(0);
  const [dedupeResult, setDedupeResult] = useState<DeduplicateResult | null>(null);
  const [dedupeError, setDedupeError] = useState<string | null>(null);
  const [dedupeBusy, setDedupeBusy] = useState(false);

  // Master "import everything" toggle. When on, all per-entity flags are forced
  // to true and usersMode is forced to "all" — typical "new chat, copy the whole
  // old chat" flow. The granular checkboxes are still rendered (as checked +
  // disabled) so the user can see what's about to happen.
  const [importEverything, setImportEverything] = useState(false);

  // Per-entity selection (all unchecked by default — opt-in migration).
  const [migrateConfig, setMigrateConfig] = useState(false);
  const [migrateUsers, setMigrateUsers] = useState(false);
  const [usersMode, setUsersMode] = useState<UsersMode>("bansOnly");
  const [migrateBannedWords, setMigrateBannedWords] = useState(false);
  const [migrateAllowances, setMigrateAllowances] = useState(false);

  const effectiveConfig = importEverything || migrateConfig;
  const effectiveUsers = importEverything || migrateUsers;
  const effectiveBannedWords = importEverything || migrateBannedWords;
  const effectiveAllowances = importEverything || migrateAllowances;
  const effectiveUsersMode: UsersMode = importEverything ? "all" : usersMode;

  const [phase, setPhase] = useState<Phase>("input");
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [finalMsg, setFinalMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.chats
      .get(chatId)
      .then(setChat)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setError("No tienes permisos en este chat.");
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [chatId, navigate]);

  useEffect(() => {
    if (!chatId) return;
    const destId = Number(chatId);
    api.chats
      .list()
      .then((all) => {
        const filtered = all
          .filter((c) => c.chatId !== destId)
          // Active chats first, then inactive.
          .sort((a, b) => Number(b.isActive === true) - Number(a.isActive === true));
        setSources(filtered);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        // Non-fatal — the manual fallback still works.
        setSources([]);
      });
  }, [chatId, navigate]);

  const resolvedSourceId: number | null = useMemo(() => {
    if (sourceMode === "dropdown") {
      const n = Number(selectedSourceId);
      return Number.isFinite(n) && n !== 0 ? n : null;
    }
    const trimmed = sourceInput.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }, [sourceMode, selectedSourceId, sourceInput]);

  const anySelected =
    effectiveConfig || effectiveUsers || effectiveBannedWords || effectiveAllowances;
  const canConfirm = resolvedSourceId !== null && anySelected;

  async function run() {
    if (!chatId) return;
    if (!canConfirm) {
      if (!anySelected) {
        setError("Selecciona al menos una categoría para migrar.");
      } else {
        setError("Selecciona el chat de origen.");
      }
      setResetKey((k) => k + 1);
      return;
    }
    const src = resolvedSourceId!;
    if (src === Number(chatId)) {
      setError("El chat de origen no puede ser este mismo chat.");
      setResetKey((k) => k + 1);
      return;
    }

    const selection: MigrationSelection = {
      chatConfig: effectiveConfig,
      users: effectiveUsers,
      bannedWords: effectiveBannedWords,
      domainAllowances: effectiveAllowances,
      usersMode: effectiveUsersMode,
    };

    setPhase("loading");
    setError(null);
    try {
      // The copy itself is fast; the 3s floor gives the user a clear, calm
      // "working…" beat before the result lands.
      const [res] = await Promise.all([api.migration.run(chatId, src, selection), sleep(3000)]);
      setSummary(res);
      setPhase("done");
      setSheetOpen(true);
      invalidateChat(chatId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        navigate("/login", { replace: true });
        return;
      }
      setError(mapError(err, src));
      setPhase("input");
      setResetKey((k) => k + 1);
    }
  }

  async function runDedupe() {
    if (!chatId) return;
    setDedupeBusy(true);
    setDedupeError(null);
    setDedupeResult(null);
    try {
      const [res] = await Promise.all([api.users.deduplicate(chatId), sleep(800)]);
      setDedupeResult(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        navigate("/login", { replace: true });
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDedupeError("Solo el propietario puede limpiar duplicados.");
      } else {
        setDedupeError(err instanceof Error ? err.message : "Error inesperado.");
      }
      setDedupeResetKey((k) => k + 1);
    } finally {
      setDedupeBusy(false);
    }
  }

  async function decide(active: boolean) {
    if (!chatId || !summary) return;
    setSheetBusy(true);
    setError(null);
    try {
      await api.migration.setSourceActive(chatId, summary.sourceChatId, active);
      setFinalMsg(
        active
          ? `El chat antiguo (${summary.sourceChatId}) permanece activo.`
          : `El chat antiguo (${summary.sourceChatId}) se marcó como inactivo. No se borró ningún dato.`
      );
      setSheetOpen(false);
    } catch (err) {
      setError(mapError(err, summary.sourceChatId));
    } finally {
      setSheetBusy(false);
    }
  }

  const dropdownOptions = sources ?? [];

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Migrar datos${chat ? ` · ${chat.name}` : ""}`}
        onBack={() => navigate(`/chats/${chatId}`)}
      />
      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>
            Copia datos seleccionados desde otro chat a <b>este</b> chat. Los usuarios que ya
            existan se combinan con la información del origen (los avisos nunca disminuyen).
            Nada se borra del chat de origen.
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

        {phase === "input" && (
          <>
            <div className="yk-section">
              <div className="yk-card" style={{ padding: 18 }}>
                <div className="yk-row-title" style={{ marginBottom: 6 }}>
                  Chat de origen
                </div>
                <div className="yk-row-sub" style={{ whiteSpace: "normal", marginBottom: 12 }}>
                  {sourceMode === "dropdown"
                    ? "Elige el chat antiguo desde el que copiar datos."
                    : "Introduce el ID numérico del chat (p. ej. -1001234567890)."}
                </div>

                {sourceMode === "dropdown" ? (
                  <select
                    className="yk-input"
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 40px 12px 14px",
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "var(--bg-elev)",
                      color: "var(--ink-900)",
                      fontSize: 16,
                      marginBottom: 10,
                      appearance: "none",
                      WebkitAppearance: "none",
                      MozAppearance: "none",
                      backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'><path d='M1 1L6 6L11 1' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 14px center",
                    }}
                  >
                    <option value="">Selecciona un chat</option>
                    {dropdownOptions.map((s) => (
                      <option key={s.chatId} value={String(s.chatId)}>
                        {s.name} ({s.chatId}){s.isActive ? "" : " — inactivo"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="yk-input"
                    inputMode="numeric"
                    placeholder="-100..."
                    value={sourceInput}
                    onChange={(e) => setSourceInput(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "var(--bg-elev)",
                      color: "var(--ink-900)",
                      fontSize: 16,
                      marginBottom: 10,
                    }}
                  />
                )}

                <button
                  type="button"
                  onClick={() =>
                    setSourceMode(sourceMode === "dropdown" ? "manual" : "dropdown")
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--brand-700)",
                    padding: 0,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {sourceMode === "dropdown"
                    ? "Usar ID manualmente"
                    : "Elegir de la lista"}
                </button>
              </div>
            </div>

            <div className="yk-section">
              <div className="yk-card" style={{ padding: 18 }}>
                <div className="yk-row-title" style={{ marginBottom: 6 }}>
                  ¿Qué quieres migrar?
                </div>
                <div className="yk-row-sub" style={{ whiteSpace: "normal", marginBottom: 14 }}>
                  Marca las categorías a copiar. Los usuarios que ya existan en este chat se
                  combinarán con los datos del origen (avisos máx., motivos unidos, bans OR).
                </div>

                <CheckboxRow
                  checked={importEverything}
                  onChange={setImportEverything}
                  title="Importar todo del chat de origen"
                  subtitle="Copia la configuración, todos los usuarios (avisos + bans), palabras prohibidas y permisos mixtos."
                />

                <div
                  style={{
                    height: 1,
                    background: "var(--line)",
                    margin: "10px 0",
                    opacity: 0.5,
                  }}
                />

                <CheckboxRow
                  checked={effectiveConfig}
                  onChange={setMigrateConfig}
                  disabled={importEverything}
                  title="Configuración del chat"
                  subtitle="Funciones, listas blancas y canal de logs."
                />
                <CheckboxRow
                  checked={effectiveUsers}
                  onChange={setMigrateUsers}
                  disabled={importEverything}
                  title="Usuarios"
                  subtitle={
                    effectiveUsersMode === "bansOnly"
                      ? "Solo usuarios baneados (sin avisos ni motivos)."
                      : "Usuarios con avisos y/o baneos."
                  }
                />
                {effectiveUsers && !importEverything && (
                  <div style={{ paddingLeft: 36, marginTop: -6, marginBottom: 6 }}>
                    <RadioRow
                      name="usersMode"
                      value="bansOnly"
                      checked={usersMode === "bansOnly"}
                      onChange={() => setUsersMode("bansOnly")}
                      label="Solo baneados (sin avisos)"
                    />
                    <RadioRow
                      name="usersMode"
                      value="all"
                      checked={usersMode === "all"}
                      onChange={() => setUsersMode("all")}
                      label="Todos (avisos + bans)"
                    />
                  </div>
                )}
                <CheckboxRow
                  checked={effectiveBannedWords}
                  onChange={setMigrateBannedWords}
                  disabled={importEverything}
                  title="Palabras prohibidas"
                  subtitle="Solo las de ámbito global (no las por tema)."
                />
                <CheckboxRow
                  checked={effectiveAllowances}
                  onChange={setMigrateAllowances}
                  disabled={importEverything}
                  title="Permisos mixtos"
                  subtitle="Dominios permitidos por usuario."
                />
              </div>
            </div>

            <div className="yk-section">
              <div className="yk-card" style={{ padding: 18 }}>
                <SlideToConfirm
                  label={
                    canConfirm
                      ? "Desliza para migrar"
                      : !anySelected
                        ? "Marca al menos una categoría"
                        : "Elige un chat de origen"
                  }
                  resetKey={resetKey}
                  onConfirm={run}
                  disabled={!canConfirm}
                />
              </div>
            </div>

            <div className="yk-section">
              <div className="yk-card" style={{ padding: 18 }}>
                <div className="yk-row-title" style={{ marginBottom: 6 }}>
                  Quitar usuarios duplicados
                </div>
                <div className="yk-row-sub" style={{ whiteSpace: "normal", marginBottom: 14 }}>
                  Si una migración anterior dejó usuarios duplicados (mismo ID y chat), esta
                  herramienta los combina en uno solo: avisos máx., motivos unidos, bans OR. El
                  resto se elimina.
                </div>

                {dedupeError && (
                  <div
                    className="yk-banner"
                    style={{
                      background: "var(--danger-bg)",
                      color: "var(--danger-fg)",
                      marginBottom: 12,
                    }}
                  >
                    {I.alert({ size: 18 })}
                    <div>{dedupeError}</div>
                  </div>
                )}

                {dedupeResult && (
                  <div
                    className="yk-banner"
                    style={{
                      background: "var(--ok-bg, #dcfce7)",
                      color: "var(--ok-fg, #166534)",
                      marginBottom: 12,
                    }}
                  >
                    {I.check({ size: 18 })}
                    <div>
                      {dedupeResult.duplicateGroups === 0
                        ? "No había duplicados que limpiar."
                        : `Combinados ${dedupeResult.merged} usuarios · eliminados ${dedupeResult.removed} duplicados.`}
                    </div>
                  </div>
                )}

                <SlideToConfirm
                  label={dedupeBusy ? "Limpiando…" : "Desliza para limpiar duplicados"}
                  resetKey={dedupeResetKey}
                  onConfirm={runDedupe}
                  disabled={dedupeBusy}
                />
              </div>
            </div>
          </>
        )}

        {phase === "loading" && (
          <div className="yk-section">
            <div
              className="yk-card"
              style={{
                padding: 36,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                textAlign: "center",
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "3px solid var(--line)",
                  borderTopColor: "var(--brand-700)",
                  animation: "yk-spin 0.8s linear infinite",
                }}
              />
              <style>{`@keyframes yk-spin { to { transform: rotate(360deg); } }`}</style>
              <div className="yk-row-title">Migrando datos…</div>
              <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
                Copiando las categorías seleccionadas. Esto puede tardar unos segundos.
              </div>
            </div>
          </div>
        )}

        {phase === "done" && summary && (
          <div className="yk-section">
            <div
              className="yk-card"
              style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 10 }}
                className="yk-row-title"
              >
                <span style={{ color: "var(--ok-fg, #16a34a)" }}>{I.check({ size: 22 })}</span>
                Migración completada
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-700)", lineHeight: 1.9 }}>
                <li>
                  {summary.users} usuarios creados
                  {summary.usersMerged > 0 &&
                    ` · ${summary.usersMerged} combinados`}
                </li>
                <li>
                  {summary.bannedWords} palabras prohibidas
                  {summary.bannedWordsSkipped > 0 &&
                    ` (${summary.bannedWordsSkipped} ya existían)`}
                </li>
                <li>{summary.domainAllowances} permisos mixtos</li>
                <li>{summary.configCopied ? "Configuración copiada" : "Configuración no copiada"}</li>
              </ul>
              {finalMsg && (
                <div
                  className="yk-banner"
                  style={{ background: "var(--ok-bg, #dcfce7)", color: "var(--ok-fg, #166534)" }}
                >
                  {I.check({ size: 18 })}
                  <div>{finalMsg}</div>
                </div>
              )}
              {!sheetOpen && !finalMsg && (
                <button
                  type="button"
                  className="yk-row"
                  onClick={() => setSheetOpen(true)}
                  style={{ justifyContent: "center" }}
                >
                  <div className="yk-row-title">¿Qué hacer con el chat antiguo?</div>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {sheetOpen && summary && (
        <div
          className="yk-sheet-overlay"
          onClick={() => !sheetBusy && setSheetOpen(false)}
        >
          <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="yk-sheet-handle" />
            <div style={{ padding: "8px 16px 20px" }}>
              <div className="yk-row-title" style={{ marginBottom: 4 }}>
                ¿Qué hacer con el chat antiguo?
              </div>
              <div
                className="yk-row-sub"
                style={{ whiteSpace: "normal", marginBottom: 16 }}
              >
                Nada se borra. Puedes dejarlo activo o marcarlo como inactivo para que el bot deje
                de procesarlo.
              </div>
              <div className="yk-card" style={{ margin: 0 }}>
                <button
                  type="button"
                  className="yk-row"
                  disabled={sheetBusy}
                  onClick={() => decide(true)}
                >
                  <div className="yk-row-icon">{I.check({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Mantener activo</div>
                    <div className="yk-row-sub">El chat antiguo sigue funcionando.</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="yk-row"
                  disabled={sheetBusy}
                  onClick={() => decide(false)}
                >
                  <div className="yk-row-icon danger">{I.ban({ size: 20 })}</div>
                  <div className="yk-row-body">
                    <div className="yk-row-title">Marcar como inactivo</div>
                    <div className="yk-row-sub">
                      El bot deja de procesar el chat antiguo. Reversible.
                    </div>
                  </div>
                </button>
              </div>
              {sheetBusy && (
                <div className="yk-row-sub" style={{ marginTop: 12, textAlign: "center" }}>
                  Aplicando…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckboxRow({
  checked,
  onChange,
  title,
  subtitle,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "8px 0",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 4, width: 18, height: 18, accentColor: "var(--brand-700)" }}
      />
      <div style={{ flex: 1 }}>
        <div className="yk-row-title">{title}</div>
        <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
          {subtitle}
        </div>
      </div>
    </label>
  );
}

function RadioRow({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "4px 0",
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        style={{ width: 16, height: 16, accentColor: "var(--brand-700)" }}
      />
      <span className="yk-row-sub" style={{ color: "var(--ink-900)" }}>
        {label}
      </span>
    </label>
  );
}
