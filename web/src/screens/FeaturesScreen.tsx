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
    id: "languageDetection",
    name: "Detección de idioma",
    desc: "Avisará si se habla fuera del idioma del grupo.",
    soon: true,
  },
];

export function FeaturesScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [features, setFeatures] = useState<ChatFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);

  useEffect(() => {
    if (!chatId) return;
    api.chats
      .get(chatId)
      .then((c) => {
        setChat(c);
        setFeatures(c.features);
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
      </div>
    </div>
  );
}
