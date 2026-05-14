import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { Dropdown } from "../components/Dropdown";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import type { BannedWord, BannedWordCreateBody, Topic } from "../types/api";

type Scope = "all" | "topic";

interface ComboState {
  delete: boolean;
  warn: boolean;
  silence: boolean;
}

interface ComboActionMeta {
  id: keyof ComboState;
  label: string;
  desc: string;
}

const COMBO_ACTIONS: ComboActionMeta[] = [
  { id: "delete", label: "Borrar el mensaje", desc: "Elimina el mensaje cuando se detecta." },
  { id: "warn", label: "Dar aviso al usuario", desc: "Suma 1/3 a su contador. Al tercero se banea." },
  { id: "silence", label: "Silenciar 1 semana", desc: "No podrá escribir durante 7 días." },
];

interface ChipDef {
  label: string;
  tone: "info" | "warn" | "danger" | "ok";
}

function chipsForWord(w: BannedWord): ChipDef[] {
  if (w.kick) return [{ label: "expulsar", tone: "danger" }];
  const chips: ChipDef[] = [];
  if (w.actions.delete) chips.push({ label: "borrar", tone: "warn" });
  if (w.actions.warn) chips.push({ label: "aviso", tone: "warn" });
  if (w.actions.silence) chips.push({ label: "silenciar", tone: "info" });
  if (w.flag) chips.push({ label: "avisar admins", tone: "info" });
  return chips.length > 0 ? chips : [{ label: w.severity, tone: "warn" }];
}

function iconToneForWord(w: BannedWord): string {
  if (w.kick) return "danger";
  if (w.actions.silence) return "info";
  return "warm";
}

interface AddWordSheetProps {
  defaultScope: Scope;
  defaultTopicId?: number;
  topics: Topic[];
  showTopicChoice: boolean;
  onClose: () => void;
  onSubmit: (body: BannedWordCreateBody) => Promise<void>;
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
  const [combo, setCombo] = useState<ComboState>({ delete: false, warn: true, silence: false });
  const [kick, setKick] = useState(false);
  const [warnReason, setWarnReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCombo(key: keyof ComboState) {
    if (busy) return;
    setKick(false);
    setCombo((c) => ({ ...c, [key]: !c[key] }));
  }

  function pickKick() {
    if (busy) return;
    setCombo({ delete: false, warn: false, silence: false });
    setKick(true);
  }

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
    const anyAction = kick || combo.delete || combo.warn || combo.silence;
    if (!anyAction) {
      setError("Elige al menos una acción.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        word: word.trim(),
        actions: kick ? { delete: false, warn: false, silence: false } : combo,
        kick,
        flag: false,
        warnReason: combo.warn && warnReason.trim() ? warnReason.trim() : undefined,
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yk-sheet-overlay" onClick={onClose}>
      <div
        className="yk-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", overflowY: "auto" }}
      >
        <div className="yk-sheet-handle" />
        <div style={{ padding: "8px 20px 24px" }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>Añadir palabra</div>

          <div className="yk-field" style={{ marginBottom: 12 }}>
            <label className="yk-label" htmlFor="bw-word">Palabra o frase</label>
            <input
              id="bw-word"
              className="yk-input"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="palabrota, frase, etc."
              disabled={busy}
              autoFocus
            />
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
              cursor: busy ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={exact}
              onChange={(e) => setExact(e.target.checked)}
              disabled={busy}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Coincidencia exacta</div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                Solo cuando aparezca como palabra completa.
              </div>
            </div>
          </label>

          {showTopicChoice && (
            <div className="yk-field" style={{ marginBottom: 16 }}>
              <label className="yk-label">Ámbito</label>
              <div className="yk-segmented" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={scope === "all" ? "active" : ""}
                  onClick={() => !busy && setScope("all")}
                >
                  Todo el chat
                </button>
                <button
                  type="button"
                  className={scope === "topic" ? "active" : ""}
                  onClick={() => !busy && setScope("topic")}
                >
                  Solo un tema
                </button>
              </div>
              {scope === "topic" && (
                <Dropdown<number>
                  value={topicId}
                  options={topics.map((t) => ({
                    value: t.topicId,
                    label: t.name?.trim() || `Tema #${t.topicId}`,
                  }))}
                  onChange={(v) => setTopicId(v)}
                  placeholder={topics.length === 0 ? "Sin temas en este chat" : "Selecciona un tema"}
                  disabled={busy || topics.length === 0}
                  ariaLabel="Selecciona el tema"
                />
              )}
            </div>
          )}

          <div className="yk-field">
            <label className="yk-label">¿Qué hace el bot al detectarla?</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {COMBO_ACTIONS.map((a) => {
                const checked = combo[a.id];
                return (
                  <label
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      border: `1.5px solid ${checked && !kick ? "var(--brand-400)" : "var(--ink-100)"}`,
                      background: checked && !kick ? "var(--brand-50)" : "transparent",
                      borderRadius: 14,
                      cursor: busy ? "default" : "pointer",
                      opacity: kick ? 0.5 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked && !kick}
                      onChange={() => toggleCombo(a.id)}
                      disabled={busy || kick}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{a.label}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{a.desc}</div>
                    </div>
                  </label>
                );
              })}

              {combo.warn && !kick && (
                <div className="yk-field" style={{ marginTop: 4, marginBottom: 4 }}>
                  <label className="yk-label" htmlFor="bw-reason" style={{ fontSize: 13 }}>
                    Razón del aviso (opcional)
                  </label>
                  <textarea
                    id="bw-reason"
                    className="yk-textarea"
                    rows={2}
                    placeholder="Se muestra al usuario en el aviso. Si la dejas vacía se usa la palabra."
                    value={warnReason}
                    onChange={(e) => setWarnReason(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  border: `1.5px solid ${kick ? "var(--danger-fg)" : "var(--ink-100)"}`,
                  background: kick ? "var(--danger-bg)" : "transparent",
                  borderRadius: 14,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                <input
                  type="radio"
                  name="bw-kick"
                  checked={kick}
                  onChange={pickKick}
                  disabled={busy}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>Expulsar del grupo</div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    Sustituye a las demás acciones. Puede volver a entrar.
                  </div>
                </div>
              </label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  border: "1.5px solid var(--ink-100)",
                  background: "var(--bg-sunken)",
                  borderRadius: 14,
                  cursor: "default",
                  opacity: 0.55,
                }}
                aria-disabled="true"
              >
                <input type="checkbox" checked={false} disabled />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
                    Avisar a admins
                    <span className="yk-chip">Próximamente</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    Notificación al canal de logs sin actuar sobre el usuario.
                  </div>
                </div>
              </div>
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
                marginTop: 12,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="button"
            className="yk-btn"
            onClick={submit}
            disabled={busy}
            style={{ marginTop: 12 }}
          >
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
  const chips = chipsForWord(w);
  return (
    <div className="yk-row" style={{ cursor: "default" }}>
      <div className={`yk-row-icon ${iconToneForWord(w)}`}>{I.word({ size: 20 })}</div>
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
          style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
        >
          {chips.map((c) => (
            <span key={c.label} className={`yk-chip ${c.tone}`}>
              {c.label}
            </span>
          ))}
          {showTopic && w.scope === "topic" && w.topicId !== null && w.topicId !== undefined && (
            <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
              · {topicNameById.get(w.topicId) ?? `Tema #${w.topicId}`}
            </span>
          )}
        </div>
        {w.warnReason && (
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, fontStyle: "italic" }}>
            “{w.warnReason}”
          </div>
        )}
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

  async function addWord(body: BannedWordCreateBody): Promise<void> {
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
          <Dropdown<number>
            value={topicId}
            options={topics.map((t) => ({
              value: t.topicId,
              label: t.name?.trim() || `Tema #${t.topicId}`,
            }))}
            onChange={(v) => setTopicId(v)}
            placeholder={topics.length === 0 ? "Sin temas conocidos" : "Filtrar por tema"}
            disabled={topics.length === 0}
            ariaLabel="Filtrar por tema"
          />
        </div>
      )}

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 16px 16px" }}>
          <div className="yk-banner warn" style={{ margin: 0 }}>
            {I.alert({ size: 18 })}
            <div>{banner}</div>
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
