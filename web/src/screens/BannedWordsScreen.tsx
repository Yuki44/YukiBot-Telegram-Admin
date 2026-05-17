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

/** Map an API error code to a friendly Spanish message for the add/edit sheet. */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "duplicate_word":
        return "Esa palabra ya está añadida con esa configuración.";
      case "warn_reason_required":
        return "El aviso necesita una razón.";
      case "fuzzy_needs_single_word":
        return "La detección flexible solo se puede usar con una sola palabra.";
      case "no_action_selected":
        return "Elige al menos una acción.";
      case "invalid_word":
        return "Escribe la palabra o frase.";
    }
  }
  return err instanceof Error ? err.message : "error";
}

interface ChipDef {
  label: string;
  tone: "info" | "warn" | "danger" | "ok";
}

function chipsForWord(w: BannedWord): ChipDef[] {
  // Legacy rows created before "Expulsar del grupo" was removed still enforce a
  // kick — surface it so an owner can spot and delete/edit them.
  if (w.kick) return [{ label: "expulsar", tone: "danger" }];
  const chips: ChipDef[] = [];
  if (w.actions.delete) chips.push({ label: "borrar", tone: "warn" });
  if (w.actions.warn) chips.push({ label: "aviso", tone: "warn" });
  if (w.actions.silence) chips.push({ label: "silenciar", tone: "info" });
  if (w.flag) chips.push({ label: "avisar admins", tone: "info" });
  return chips.length > 0 ? chips : [{ label: w.severity, tone: "warn" }];
}

interface IconDef {
  render: ReactNode;
  tone: string;
}

/** Action-aware row icon: trash / mute / triangle, a combo icon for 2+, ban for legacy kick. */
function iconForWord(w: BannedWord): IconDef {
  if (w.kick) return { render: I.ban({ size: 20 }), tone: "danger" };
  const count = Number(w.actions.delete) + Number(w.actions.warn) + Number(w.actions.silence);
  if (count >= 2) return { render: I.list({ size: 20 }), tone: "warm" };
  if (w.actions.silence) return { render: I.silence({ size: 20 }), tone: "info" };
  if (w.actions.warn) return { render: I.alert({ size: 20 }), tone: "warm" };
  if (w.actions.delete) return { render: I.trash({ size: 20 }), tone: "warm" };
  return { render: I.word({ size: 20 }), tone: "warm" };
}

interface AddWordSheetProps {
  initial?: BannedWord;
  defaultScope: Scope;
  defaultTopicId?: number;
  topics: Topic[];
  showTopicChoice: boolean;
  onClose: () => void;
  onSubmit: (body: BannedWordCreateBody) => Promise<void>;
}

function AddWordSheet({
  initial,
  defaultScope,
  defaultTopicId,
  topics,
  showTopicChoice,
  onClose,
  onSubmit,
}: AddWordSheetProps) {
  const isEditing = !!initial;
  const [word, setWord] = useState(initial?.word ?? "");
  const [exact, setExact] = useState(initial?.exactMatch ?? false);
  const [scope, setScope] = useState<Scope>(initial?.scope ?? defaultScope);
  const [topicId, setTopicId] = useState<number | undefined>(
    initial?.topicId ?? defaultTopicId ?? topics[0]?.topicId
  );
  const [combo, setCombo] = useState<ComboState>(
    initial
      ? { delete: initial.actions.delete, warn: initial.actions.warn, silence: initial.actions.silence }
      : { delete: false, warn: true, silence: false }
  );
  const [warnReason, setWarnReason] = useState(initial?.warnReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flexible detection only makes sense for a single token. Disable + force off
  // the moment the input becomes a phrase.
  const trimmedWord = word.trim();
  const canBeFlexible = trimmedWord.length > 0 && !/\s/.test(trimmedWord);
  useEffect(() => {
    if (exact && !canBeFlexible) setExact(false);
  }, [exact, canBeFlexible]);

  function toggleCombo(key: keyof ComboState) {
    if (busy) return;
    setCombo((c) => ({ ...c, [key]: !c[key] }));
  }

  async function submit() {
    if (busy) return;
    if (trimmedWord.length < 1) {
      setError("Escribe la palabra o frase.");
      return;
    }
    if (exact && !canBeFlexible) {
      setError("La detección flexible solo se puede usar con una sola palabra.");
      return;
    }
    if (scope === "topic" && (topicId === undefined || !Number.isFinite(topicId))) {
      setError("Selecciona un tema.");
      return;
    }
    if (!combo.delete && !combo.warn && !combo.silence) {
      setError("Elige al menos una acción.");
      return;
    }
    if (combo.warn && warnReason.trim().length < 1) {
      setError("Escribe la razón del aviso.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        word: trimmedWord,
        actions: combo,
        kick: false,
        flag: false,
        warnReason: combo.warn ? warnReason.trim() : undefined,
        exactMatch: exact,
        scope,
        topicId: scope === "topic" ? topicId : undefined,
      });
    } catch (err) {
      setError(errorMessage(err));
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
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            {isEditing ? "Editar palabra" : "Añadir palabra"}
          </div>

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
              marginBottom: canBeFlexible ? 16 : 6,
              cursor: busy || !canBeFlexible ? "default" : "pointer",
              opacity: canBeFlexible ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={exact}
              onChange={(e) => setExact(e.target.checked)}
              disabled={busy || !canBeFlexible}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Detección flexible</div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                También detecta letras y emojis parecidos. Solo para una sola palabra.
              </div>
            </div>
          </label>
          {!canBeFlexible && trimmedWord.includes(" ") && (
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 16 }}>
              La detección flexible solo está disponible para una sola palabra.
            </div>
          )}

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
                      border: `1.5px solid ${checked ? "var(--brand-400)" : "var(--ink-100)"}`,
                      background: checked ? "var(--brand-50)" : "transparent",
                      borderRadius: 14,
                      cursor: busy ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCombo(a.id)}
                      disabled={busy}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{a.label}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{a.desc}</div>
                    </div>
                  </label>
                );
              })}

              {combo.warn && (
                <div className="yk-field" style={{ marginTop: 4, marginBottom: 4 }}>
                  <label className="yk-label" htmlFor="bw-reason" style={{ fontSize: 13 }}>
                    Razón del aviso (obligatorio)
                  </label>
                  <textarea
                    id="bw-reason"
                    className="yk-textarea"
                    rows={2}
                    placeholder="Se muestra al usuario en el aviso."
                    value={warnReason}
                    onChange={(e) => setWarnReason(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}

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
            {busy
              ? isEditing
                ? "Guardando…"
                : "Añadiendo…"
              : isEditing
                ? "Guardar"
                : "Añadir palabra"}
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
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
  showTopic: boolean;
}

function WordRow({ word: w, topicNameById, removing, canManage, onEdit, onRemove, showTopic }: WordRowProps) {
  const chips = chipsForWord(w);
  const icon = iconForWord(w);
  return (
    <div className="yk-row" style={{ cursor: "default" }}>
      <div className={`yk-row-icon ${icon.tone}`}>{icon.render}</div>
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
              flexible
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
      {canManage && (
        <div className="yk-row-trail" style={{ display: "flex", gap: 2 }}>
          <button
            type="button"
            onClick={onEdit}
            disabled={removing}
            aria-label="Editar"
            style={{
              background: "transparent",
              border: 0,
              cursor: removing ? "default" : "pointer",
              padding: 6,
              color: "var(--ink-500)",
              opacity: removing ? 0.4 : 1,
            }}
          >
            {I.edit({ size: 18 })}
          </button>
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
      )}
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
  const [editing, setEditing] = useState<BannedWord | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTopicsChat = chat?.type === "topics";
  const canManage = chat?.role === "owner" || chat?.role === "super";

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

  async function submitWord(body: BannedWordCreateBody): Promise<void> {
    if (!chatId) return;
    if (editing) {
      const updated = await api.bannedWords.update(chatId, editing.id, body);
      setWords((prev) => prev?.map((w) => (w.id === updated.id ? updated : w)) ?? [updated]);
      setEditing(null);
    } else {
      const created = await api.bannedWords.create(chatId, body);
      setWords((prev) => (prev ? [...prev, created] : [created]));
      setShowAdd(false);
    }
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

  const sheetOpen = showAdd || editing !== null;

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
                canManage={canManage}
                onEdit={() => setEditing(w)}
                onRemove={() => removeWord(w.id)}
                showTopic={scope === "all"}
              />
            ))}
          </div>
        </div>
      </div>

      {sheetOpen && (
        <AddWordSheet
          key={editing?.id ?? "new"}
          initial={editing ?? undefined}
          defaultScope={scope}
          defaultTopicId={topicId}
          topics={topics}
          showTopicChoice={isTopicsChat}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSubmit={submitWord}
        />
      )}
    </div>
  );
}
