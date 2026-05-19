import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { SlideToConfirm } from "../components/SlideToConfirm";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { invalidateChat } from "../lib/useChat";
import type { ChatDetail, MigrationSummary } from "../types/api";

type Phase = "input" | "loading" | "done";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mapError(err: unknown, sourceChatId: number): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Solo el propietario de este chat puede migrar datos.";
    if (err.code === "source_not_found")
      return `No se encontró el chat de origen (${sourceChatId}).`;
    if (err.code === "dest_not_found")
      return "Este chat aún no está inicializado. Ejecuta /setup primero.";
    if (err.code === "invalid_source") return "El ID del chat de origen no es válido.";
  }
  return err instanceof Error ? err.message : "Error inesperado.";
}

export function MigrationScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [sourceInput, setSourceInput] = useState("");
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

  async function run() {
    if (!chatId) return;
    const src = Number(sourceInput.trim());
    if (sourceInput.trim() === "" || !Number.isFinite(src)) {
      setError("Introduce un ID de chat de origen válido.");
      setResetKey((k) => k + 1);
      return;
    }
    if (src === Number(chatId)) {
      setError("El chat de origen no puede ser este mismo chat.");
      setResetKey((k) => k + 1);
      return;
    }

    setPhase("loading");
    setError(null);
    try {
      // The copy itself is fast; the 3s floor gives the user a clear, calm
      // "working…" beat before the result lands.
      const [res] = await Promise.all([api.migration.run(chatId, src), sleep(3000)]);
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
            Copia usuarios (avisos y bans), funciones activas, listas blancas y palabras prohibidas
            del chat de origen a <b>este</b> chat. No se importan el registro, el equipo de admins
            ni el estado de silenciados. Nada se borra del chat de origen.
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
          <div className="yk-section">
            <div className="yk-card" style={{ padding: 18 }}>
              <div className="yk-row-title" style={{ marginBottom: 6 }}>
                ID del chat de origen
              </div>
              <div className="yk-row-sub" style={{ whiteSpace: "normal", marginBottom: 12 }}>
                Es el ID numérico del chat antiguo (p. ej. -1001234567890).
              </div>
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
                  marginBottom: 18,
                }}
              />
              <SlideToConfirm
                label="Desliza para migrar"
                resetKey={resetKey}
                onConfirm={run}
              />
            </div>
          </div>
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
                Copiando usuarios, listas y configuración. Esto puede tardar unos segundos.
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
                <li>{summary.users} usuarios</li>
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
