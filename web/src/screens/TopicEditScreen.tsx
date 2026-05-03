import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import type { MsgType, Topic } from "../types/api";
import { ALL_MSG_TYPES } from "../types/api";

interface MsgTypeMeta {
  id: MsgType;
  label: string;
  icon: () => ReactNode;
}

const MSG_TYPE_META: MsgTypeMeta[] = [
  { id: "text", label: "Texto", icon: () => I.text({ size: 14 }) },
  { id: "photo", label: "Fotos", icon: () => I.photo({ size: 14 }) },
  { id: "video", label: "Vídeos", icon: () => I.video({ size: 14 }) },
  { id: "sticker", label: "Stickers", icon: () => I.sticker({ size: 14 }) },
  { id: "voice", label: "Audios de voz", icon: () => I.mic({ size: 14 }) },
  { id: "audio", label: "Música", icon: () => I.mic({ size: 14 }) },
  { id: "document", label: "Archivos", icon: () => I.file({ size: 14 }) },
];

export function TopicEditScreen() {
  const { chatId, topicId } = useParams<{ chatId: string; topicId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const isNew = topicId === "new";
  const numericTopicId = isNew ? null : Number(topicId);

  const [topic, setTopic] = useState<Topic | null>(
    isNew ? { chatId: Number(chatId), topicId: 0, name: "", allowedMsgTypes: [] } : null
  );
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [topicIdInput, setTopicIdInput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) {
      setAllowed(new Set());
      setName("");
      setTopicIdInput("");
      return;
    }
    if (!chatId || numericTopicId === null) return;
    api.topics
      .list(chatId)
      .then((all) => {
        const found = all.find((t) => t.topicId === numericTopicId);
        if (!found) {
          setError("Tema no encontrado.");
          return;
        }
        setTopic(found);
        setName(found.name);
        setAllowed(new Set(found.allowedMsgTypes));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [chatId, numericTopicId, isNew, navigate]);

  function toggle(id: MsgType) {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!chatId || saving) return;

    const allowedArr = ALL_MSG_TYPES.filter((t) => allowed.has(t));
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const tid = Number(topicIdInput);
        if (!Number.isFinite(tid) || tid <= 0) {
          setError("ID de tema inválido. Debe ser un número entero positivo.");
          setSaving(false);
          return;
        }
        await api.topics.create(chatId, {
          topicId: tid,
          name: "", // bot will populate from Telegram events
          allowedMsgTypes: allowedArr,
        });
      } else if (numericTopicId !== null) {
        // Don't send name on update — it's read-only here, owned by Telegram.
        await api.topics.update(chatId, numericTopicId, {
          allowedMsgTypes: allowedArr,
        });
      }
      navigate(`/chats/${chatId}/topics`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Solo el propietario puede modificar las reglas de tema.");
      } else {
        setError(err instanceof Error ? err.message : "error");
      }
      setSaving(false);
    }
  }

  async function remove() {
    if (!chatId || numericTopicId === null) return;
    if (!confirm("¿Eliminar la regla de este tema? El bot dejará de filtrar contenido aquí.")) return;
    setSaving(true);
    try {
      await api.topics.remove(chatId, numericTopicId);
      navigate(`/chats/${chatId}/topics`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
      setSaving(false);
    }
  }

  const chatSuffix = chat ? ` · ${chat.name}` : "";

  if (!topic && !error) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar
          title={`Editando tema${chatSuffix}`}
          onBack={() => navigate(`/chats/${chatId}/topics`)}
        />
        <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
      </div>
    );
  }

  const baseTitle = isNew
    ? "Nuevo tema"
    : topic?.name?.trim()
      ? topic.name
      : `Tema #${numericTopicId}`;
  const headerTitle = `${baseTitle}${chatSuffix}`;

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title={headerTitle} onBack={() => navigate(`/chats/${chatId}/topics`)} />

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "4px 16px 12px" }}>
          <div className="yk-banner" style={{ margin: 0 }}>
            {I.help({ size: 18 })}
            <div>
              {isNew
                ? "Necesitas el ID numérico del tema (lo verás en la URL del tema dentro de Telegram)."
                : "Si renombras el tema dentro de Telegram, el bot actualizará el nombre aquí automáticamente."}
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

        {isNew && (
          <div className="yk-section">
            <div className="yk-section-label">DATOS DEL TEMA</div>
            <div className="yk-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="yk-field">
                <label className="yk-label">ID del tema</label>
                <input
                  className="yk-input"
                  inputMode="numeric"
                  value={topicIdInput}
                  onChange={(e) => setTopicIdInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="123"
                />
                <div className="yk-help" style={{ marginTop: 8 }}>
                  El nombre lo aprende el bot automáticamente cuando recibe el primer mensaje del
                  tema o cuando lo renombras dentro de Telegram.
                </div>
              </div>
            </div>
          </div>
        )}

        {!isNew && (
          <div className="yk-section">
            <div className="yk-section-label">NOMBRE DEL TEMA</div>
            <div className="yk-card" style={{ padding: 14 }}>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: name ? "var(--ink-900)" : "var(--ink-500)",
                  fontStyle: name ? "normal" : "italic",
                }}
              >
                {name || `Tema #${numericTopicId}`}
              </div>
              <div className="yk-help" style={{ marginTop: 8 }}>
                Solo se puede cambiar desde Telegram. El bot lo actualiza aquí en cuanto detecta el
                cambio.
              </div>
            </div>
          </div>
        )}

        <div className="yk-section">
          <div className="yk-section-label">¿QUÉ SE PUEDE ENVIAR?</div>
          <div className="yk-card" style={{ padding: 14 }}>
            <div className="yk-pill-grid">
              {MSG_TYPE_META.map((m) => {
                const on = allowed.has(m.id);
                return (
                  <button
                    key={m.id}
                    className={`yk-pill ${on ? "on" : ""}`}
                    onClick={() => toggle(m.id)}
                    type="button"
                  >
                    {m.icon()}
                    {m.label}
                    {on && I.check({ size: 14 })}
                  </button>
                );
              })}
            </div>
            <div className="yk-help" style={{ marginTop: 10 }}>
              Los tipos no marcados se borrarán automáticamente cuando llegue un mensaje a este tema.
            </div>
          </div>
        </div>

        <div style={{ padding: "8px 16px 16px", display: "flex", gap: 10 }}>
          {!isNew && (
            <button
              className="yk-btn outline"
              type="button"
              onClick={remove}
              disabled={saving}
              style={{
                color: "var(--danger-fg)",
                borderColor: "var(--danger-bg)",
                width: "auto",
                padding: "14px 16px",
              }}
            >
              {I.trash({ size: 18 })}
            </button>
          )}
          <button className="yk-btn" type="button" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
