import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { invalidateChat } from "../lib/useChat";
import type { ChatDetail, ChatFeatures } from "../types/api";

type FeatureKey = keyof ChatFeatures;

interface FeatureMeta {
  id: FeatureKey;
  name: string;
  desc: string;
  topicsOnly?: boolean;
  soon?: boolean;
}

const FEATURE_META: FeatureMeta[] = [
  {
    id: "topicFiltering",
    name: "Reglas por tema",
    desc: "Permite distintos tipos de contenido en cada tema.",
    topicsOnly: true,
  },
  {
    id: "autoBan",
    name: "Re-ban automático",
    desc: "Si alguien baneado vuelve, se le expulsa solo.",
  },
  {
    id: "autoWarnSpam",
    name: "Aviso automático por spam",
    desc: "Avisa a quien envíe spam detectado.",
  },
  {
    id: "promoSpamDetection",
    name: "Detección de promo/scam",
    desc: "Detecta enlaces sospechosos y patrones de spam aprendidos.",
  },
  {
    id: "bannedWordsEnforcement",
    name: "Aplicar palabras prohibidas",
    desc: "Cuando alguien escriba una palabra de la lista, se aplica la acción configurada (aviso, borrar, silenciar o expulsar).",
  },
  {
    id: "csamDetection",
    name: "Detección CP / cuentas impostoras",
    desc: "Analiza imágenes (OCR) y biografías en busca del vendedor de CP y sus cuentas ALT. Coincidencia clara en bio → baneo automático en todos los chats; imágenes o casos dudosos → silencio y aviso al chat de admins para revisión manual. Nunca banea a quien va en contra (p. ej. «no cp»).",
  },
  {
    id: "welcomeMessage",
    name: "Mensaje de bienvenida",
    desc: "Saluda automáticamente a quien entra al grupo. Configura el mensaje y el botón en su pantalla.",
  },
  {
    id: "languageDetection",
    name: "Detección de idioma",
    desc: "Avisará si se habla fuera del idioma del grupo.",
  },
  {
    id: "trackNameChanges",
    name: "Seguimiento de nombres",
    desc: "Detecta cuándo alguien cambia su nombre o @usuario y mantiene sus datos al día. El aviso va siempre al canal de registro.",
  },
  {
    id: "nameChangesVisible",
    name: "Mostrar cambios de nombre en el grupo",
    desc: "Publica también en el grupo los avisos de «Seguimiento de nombres». Si está apagado, solo se ven en el canal de registro.",
  },
  {
    id: "topicReminders",
    name: "Recordatorio de normas por tema",
    desc: "Republica las normas de cada tema (como máximo cada 4 horas y solo si hay actividad), borrando el recordatorio anterior. Configura el texto de cada tema y el botón en Reglas por tema.",
    topicsOnly: true,
  },
];

export function FeaturesScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [features, setFeatures] = useState<ChatFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);

  const [notifySpam, setNotifySpam] = useState(false);
  const [notifyCsam, setNotifyCsam] = useState(false);
  const [notifyChatIdInput, setNotifyChatIdInput] = useState("");
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.chats
      .get(chatId)
      .then((c) => {
        setChat(c);
        setFeatures(c.features);
        setNotifySpam(!!c.notifyFlags?.notifySpam);
        setNotifyCsam(!!c.notifyFlags?.notifyCsam);
        setNotifyChatIdInput(c.notifyChatId != null ? String(c.notifyChatId) : "");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [chatId, navigate]);

  async function toggle(key: FeatureKey, soon: boolean | undefined) {
    if (!features || !chatId || soon || savingKey) return;
    const next = !features[key];
    const previous = features[key];
    setFeatures({ ...features, [key]: next });
    setSavingKey(key);
    try {
      const updated = await api.chats.updateFeatures(chatId, { [key]: next });
      setFeatures(updated);
      invalidateChat(chatId);
    } catch (err) {
      setFeatures({ ...features, [key]: previous });
      if (err instanceof ApiError && err.status === 403) {
        setError("Solo el propietario puede cambiar funciones.");
      } else {
        setError(err instanceof Error ? err.message : "error");
      }
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleNotifySpam() {
    if (!chatId || notifySaving) return;
    const next = !notifySpam;
    const previous = notifySpam;
    setNotifySpam(next);
    setNotifySaving(true);
    setNotifyError(null);
    try {
      await api.chats.updateNotify(chatId, { notifySpam: next });
    } catch (err) {
      setNotifySpam(previous);
      setNotifyError(
        err instanceof ApiError && err.status === 403
          ? "Solo el propietario puede cambiar esto."
          : err instanceof Error
            ? err.message
            : "error"
      );
    } finally {
      setNotifySaving(false);
    }
  }

  async function toggleNotifyCsam() {
    if (!chatId || notifySaving) return;
    const next = !notifyCsam;
    const previous = notifyCsam;
    setNotifyCsam(next);
    setNotifySaving(true);
    setNotifyError(null);
    try {
      await api.chats.updateNotify(chatId, { notifyCsam: next });
    } catch (err) {
      setNotifyCsam(previous);
      setNotifyError(
        err instanceof ApiError && err.status === 403
          ? "Solo el propietario puede cambiar esto."
          : err instanceof Error
            ? err.message
            : "error"
      );
    } finally {
      setNotifySaving(false);
    }
  }

  async function saveNotifyChatId(e: React.FormEvent) {
    e.preventDefault();
    if (!chatId || notifySaving) return;
    const trimmed = notifyChatIdInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && !Number.isInteger(parsed)) {
      setNotifyError("El ID de chat debe ser un número entero.");
      return;
    }
    setNotifySaving(true);
    setNotifyError(null);
    try {
      const updated = await api.chats.updateNotify(chatId, { notifyChatId: parsed });
      setNotifyChatIdInput(updated.notifyChatId != null ? String(updated.notifyChatId) : "");
    } catch (err) {
      setNotifyError(
        err instanceof ApiError && err.status === 403
          ? "Solo el propietario puede cambiar esto."
          : err instanceof Error
            ? err.message
            : "error"
      );
    } finally {
      setNotifySaving(false);
    }
  }

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={`Funciones${chat ? ` · ${chat.name}` : ""}`}
        onBack={() => navigate(`/chats/${chatId}`)}
      />
      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.help({ size: 18 })}
          <div>Activa solo lo que necesites. Cada función explica qué hace antes de encenderse.</div>
        </div>

        {error && (
          <div className="yk-section">
            <div className="yk-banner" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        )}

        <div className="yk-section">
          <div className="yk-card">
            {!features ? (
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            ) : (
              FEATURE_META.filter((f) => !(f.topicsOnly && chat?.type !== "topics")).map((f) => {
                const isOn = !!features[f.id];
                const disabled = !!f.soon;
                return (
                  <div
                    key={f.id}
                    className="yk-row"
                    style={{
                      cursor: disabled ? "default" : "pointer",
                      opacity: disabled ? 0.45 : 1,
                    }}
                    onClick={() => toggle(f.id, f.soon)}
                  >
                    <div className="yk-row-body">
                      <div
                        className="yk-row-title"
                        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                      >
                        {f.name}
                        {f.soon && <span className="yk-chip">Próximamente</span>}
                        {savingKey === f.id && <span className="yk-chip">Guardando…</span>}
                      </div>
                      <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
                        {f.desc}
                      </div>
                    </div>
                    {!disabled && <div className={`yk-switch ${isOn ? "on" : ""}`} />}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="yk-section">
          <div className="yk-card">
            <div className="yk-row" style={{ cursor: "pointer" }} onClick={toggleNotifySpam}>
              <div className="yk-row-body">
                <div
                  className="yk-row-title"
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  Notificación personal de spam
                  {notifySaving && <span className="yk-chip">Guardando…</span>}
                </div>
                <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
                  Además del registro en el canal de logs, avisa en un chat aparte cada vez que se aplica una
                  sanción por spam (automática o confirmada manualmente).
                </div>
              </div>
              <div className={`yk-switch ${notifySpam ? "on" : ""}`} />
            </div>

            <div className="yk-row" style={{ cursor: "pointer" }} onClick={toggleNotifyCsam}>
              <div className="yk-row-body">
                <div
                  className="yk-row-title"
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  Notificación personal de CP / impostor
                  {notifySaving && <span className="yk-chip">Guardando…</span>}
                </div>
                <div className="yk-row-sub" style={{ whiteSpace: "normal" }}>
                  Avisa en el chat destino cada vez que la detección de CP/impostor actúa: baneo automático
                  (bio clara) o silencio para revisión manual (imágenes o casos dudosos), con botones para
                  confirmar o deshacer.
                </div>
              </div>
              <div className={`yk-switch ${notifyCsam ? "on" : ""}`} />
            </div>

            <form
              onSubmit={saveNotifyChatId}
              style={{ padding: "12px 16px", display: "flex", gap: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                className="yk-input"
                inputMode="numeric"
                value={notifyChatIdInput}
                onChange={(e) => setNotifyChatIdInput(e.target.value)}
                placeholder="ID del chat destino (p. ej. -1001234567890)"
                disabled={notifySaving}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="yk-btn"
                disabled={notifySaving}
                style={{ width: "auto", padding: "12px 18px" }}
              >
                Guardar
              </button>
            </form>

            {notifyError && (
              <div
                role="alert"
                style={{
                  margin: "0 16px 12px",
                  background: "var(--danger-bg)",
                  color: "var(--danger-fg)",
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {notifyError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
