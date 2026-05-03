import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import type { BannedWord, BannedWordSeverity, Topic } from "../types/api";

type Scope = "all" | "topic";

interface SeverityMeta {
  id: BannedWordSeverity;
  label: string;
  desc: string;
  tone: "info" | "warn" | "danger";
}

const SEVERITIES: SeverityMeta[] = [
  { id: "flag", label: "Avisar a admins", desc: "Solo nos lo notifica, no actúa.", tone: "info" },
  { id: "aviso", label: "Dar aviso al usuario", desc: "Suma 1/3 al contador.", tone: "warn" },
  { id: "borrar", label: "Borrar el mensaje", desc: "Elimina el mensaje sin avisos.", tone: "warn" },
  { id: "silenciar", label: "Silenciar 1 semana", desc: "No podrá escribir.", tone: "info" },
  { id: "kick", label: "Expulsar del grupo", desc: "Puede volver a entrar.", tone: "danger" },
];

const SEV_LABELS: Record<BannedWordSeverity, string> = {
  flag: "avisar admins",
  aviso: "aviso",
  borrar: "borrar",
  silenciar: "silenciar",
  kick: "expulsar",
};

function severityChipTone(s: BannedWordSeverity): "info" | "warn" | "danger" {
  return SEVERITIES.find((x) => x.id === s)?.tone ?? "warn";
}

function severityIconClass(s: BannedWordSeverity): string {
  const tone = severityChipTone(s);
  return tone === "danger" ? "danger" : tone === "warn" ? "warm" : "info";
}

interface AddWordSheetProps {
  defaultScope: Scope;
  defaultTopicId?: number;
  topics: Topic[];
  showTopicChoice: boolean;
  onClose: () => void;
  onSubmit: (body: {
    word: string;
    severity: BannedWordSeverity;
    exactMatch: boolean;
    scope: Scope;
    topicId?: number;
  }) => Promise<void>;
}

function AddWordSheet({
  defaultScope,
  defaultTopicId,
  topics,
  showTopicChoice,
  onClose,
  onSubmit,
}: AddWordSheetProps) {
  const [word, setWord] = useState("");
  const [exact, setExact] = useState(false);
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [topicId, setTopicId] = useState<number | undefined>(defaultTopicId ?? topics[0]?.topicId);
  const [sev, setSev] = useState<BannedWordSeverity>("aviso");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (word.trim().length < 1) {
      setError("Escribe la palabra o frase.");
      return;
    }
    if (scope === "topic" && (topicId === undefined || !Number.isFinite(topicId))) {
      setError("Selecciona un tema.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        word: word.trim(),
        severity: sev,
        exactMatch: exact,
        scope,
        topicId: scope === "topic" ? topicId : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate_word") {
        setError("Esa palabra ya está añadida con esa configuración.");
      } else {
        setError(err instanceof Error ? err.message : "error");
      }
      setBusy(false);
    }
  }

  return (
    <div className="yk-sheet-overlay" onClick={onClose}>
      <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="yk-sheet-handle" />
        <div style={{ padding: "8px 20px 20px", maxHeight: "80vh", overflowY: "auto" }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            Nueva palabra prohibida
          </div>

          <div className="yk-field">
            <label className="yk-label">Palabra o frase</label>
            <input
              className="yk-input"
              placeholder="Ej. estafa"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="yk-field">
            <label className="yk-label">¿Coincidencia exacta?</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`yk-pill ${!exact ? "on" : ""}`}
                onClick={() => setExact(false)}
                disabled={busy}
              >
                {!exact && I.check({ size: 12 })} Parcial
              </button>
              <button
                type="button"
                className={`yk-pill ${exact ? "on" : ""}`}
                onClick={() => setExact(true)}
                disabled={busy}
              >
                {exact && I.check({ size: 12 })} Exacta
              </button>
            </div>
            <div className="yk-help">
              {exact
                ? "Solo coincide si la palabra está escrita igual (sin variaciones)."
                : "Detecta también variaciones como Sp4m, S P A M, etc."}
            </div>
          </div>

          {showTopicChoice && (
            <div className="yk-field">
              <label className="yk-label">¿Dónde se aplica?</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`yk-pill ${scope === "all" ? "on" : ""}`}
                  onClick={() => setScope("all")}
                  disabled={busy}
                >
                  Todo el chat
                </button>
                <button
                  type="button"
                  className={`yk-pill ${scope === "topic" ? "on" : ""}`}
                  onClick={() => setScope("topic")}
                  disabled={busy}
                >
                  Solo un tema
                </button>
              </div>
              {scope === "topic" && (
                <select
                  className="yk-select"
                  style={{ marginTop: 8 }}
                  value={topicId ?? ""}
                  onChange={(e) => setTopicId(Number(e.target.value))}
                  disabled={busy}
                >
                  {topics.length === 0 && <option value="">Sin temas en este chat</option>}
                  {topics.map((t) => (
                    <option key={t.topicId} value={t.topicId}>
                      {t.name?.trim() || `Tema #${t.topicId}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="yk-field">
            <label className="yk-label">¿Qué hace el bot al detectarla?</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SEVERITIES.map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 12,
                    border: `1.5px solid ${sev === s.id ? "var(--brand-400)" : "var(--ink-100)"}`,
                    background: sev === s.id ? "var(--brand-50)" : "transparent",
                    borderRadius: 14,
                    cursor: busy ? "default" : "pointer",
                  }}
                  onClick={() => !busy && setSev(s.id)}
                >
                  <input
                    type="radio"
                    name="sev"
                    checked={sev === s.id}
                    onChange={() => setSev(s.id)}
                    disabled={busy}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{s.desc}</div>
                  </div>
                </label>
              ))}
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

          <button type="button" className="yk-btn" onClick={submit} disabled={busy}>
            {busy ? "Añadiendo…" : "Añadir palabra"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              marginTop: 12,
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
        </div>
      </div>
    </div>
  );
}

interface WordRowProps {
  word: BannedWord;
  topicNameById: Map<number, string>;
  removing: boolean;
  onRemove: () => void;
  showTopic: boolean;
}

function WordRow({ word: w, topicNameById, removing, onRemove, showTopic }: WordRowProps) {
  return (
    <div className="yk-row" style={{ cursor: "default" }}>
      <div className={`yk-row-icon ${severityIconClass(w.severity)}`}>{I.word({ size: 20 })}</div>
      <div className="yk-row-body">
        <div
          className="yk-row-title yk-mono"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {w.word}
          {w.exactMatch && (
            <span className="yk-chip" style={{ fontSize: 10 }}>
              exacta
            </span>
          )}
        </div>
        <div
          className="yk-row-sub"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <span className={`yk-chip ${severityChipTone(w.severity)}`}>{SEV_LABELS[w.severity]}</span>
          {showTopic && w.scope === "topic" && w.topicId !== null && w.topicId !== undefined && (
            <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
              · {topicNameById.get(w.topicId) ?? `Tema #${w.topicId}`}
            </span>
          )}
        </div>
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

export function BannedWordsScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);

  const [words, setWords] = useState<BannedWord[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [topicId, setTopicId] = useState<number | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTopicsChat = chat?.type === "topics";

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
    api.bannedWords.list(chatId).then(setWords).catch(handleApiErr);
    if (isTopicsChat) {
      api.topics
        .list(chatId)
        .then((ts) => {
          setTopics(ts);
          if (topicId === undefined && ts.length > 0) setTopicId(ts[0].topicId);
        })
        .catch(() => {
          /* topics optional */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, isTopicsChat]);

  const topicNameById = new Map<number, string>(
    topics.map((t) => [t.topicId, t.name?.trim() || `Tema #${t.topicId}`])
  );

  const visibleWords = (words ?? []).filter((w) => {
    if (scope === "all") return w.scope === "all";
    return w.scope === "topic" && w.topicId === topicId;
  });

  async function addWord(body: {
    word: string;
    severity: BannedWordSeverity;
    exactMatch: boolean;
    scope: Scope;
    topicId?: number;
  }): Promise<void> {
    if (!chatId) return;
    const created = await api.bannedWords.create(chatId, body);
    setWords((prev) => (prev ? [...prev, created] : [created]));
    setShowAdd(false);
  }

  async function removeWord(id: string) {
    if (!chatId) return;
    setRemoving(id);
    try {
      await api.bannedWords.remove(chatId, id);
      setWords((prev) => prev?.filter((w) => w.id !== id) ?? null);
    } catch (err) {
      handleApiErr(err);
    } finally {
      setRemoving(null);
    }
  }

  const titleSuffix = chat ? ` · ${chat.name}` : "";
  const banner: ReactNode =
    scope === "all" ? (
      <>Reglas globales del chat. Se aplican en todos los mensajes.</>
    ) : (
      <>Solo se aplican dentro del tema seleccionado.</>
    );

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Palabras prohibidas${titleSuffix}`}
        onBack={() => navigate(`/chats/${chatId}`)}
        action={{
          label: "Añadir palabra",
          icon: I.plus({ size: 22 }),
          onClick: () => setShowAdd(true),
        }}
      />

      <div className="yk-segmented">
        <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
          Todo el chat
        </button>
        {isTopicsChat && (
          <button className={scope === "topic" ? "active" : ""} onClick={() => setScope("topic")}>
            Por tema
          </button>
        )}
      </div>

      {scope === "topic" && isTopicsChat && (
        <div style={{ padding: "0 16px 8px" }}>
          <select
            className="yk-select"
            value={topicId ?? ""}
            onChange={(e) => setTopicId(Number(e.target.value))}
          >
            {topics.length === 0 ? (
              <option value="">Sin temas conocidos</option>
            ) : (
              topics.map((t) => (
                <option key={t.topicId} value={t.topicId}>
                  {t.name?.trim() || `Tema #${t.topicId}`}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 16px 16px" }}>
          <div className="yk-banner warn" style={{ margin: 0 }}>
            {I.alert({ size: 18 })}
            <div>{banner}</div>
          </div>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <div
            className="yk-banner"
            style={{ margin: 0, background: "var(--bg-sunken)", color: "var(--ink-500)" }}
          >
            {I.help({ size: 18 })}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Aún no se aplica</div>
              YukiBot guarda estas reglas pero todavía no las usa en mensajes nuevos. La detección
              automática de palabras llega en una actualización futura del bot.
            </div>
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
            {words === null && (
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            )}
            {words && visibleWords.length === 0 && (
              <div className="yk-empty">
                <div className="yk-empty-icon">{I.word({ size: 28 })}</div>
                <div className="yk-empty-title">Sin palabras todavía</div>
                <div>Toca + arriba para añadir la primera.</div>
              </div>
            )}
            {visibleWords.map((w) => (
              <WordRow
                key={w.id}
                word={w}
                topicNameById={topicNameById}
                removing={removing === w.id}
                onRemove={() => removeWord(w.id)}
                showTopic={scope === "all"}
              />
            ))}
          </div>
        </div>
      </div>

      {showAdd && (
        <AddWordSheet
          defaultScope={scope}
          defaultTopicId={topicId}
          topics={topics}
          showTopicChoice={isTopicsChat}
          onClose={() => setShowAdd(false)}
          onSubmit={addWord}
        />
      )}
    </div>
  );
}
