import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import type { BroadcastPost, ChannelBroadcast } from "../types/api";

const madridFmt = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

function scheduleLabel(hours: number[]): string {
  return hours
    .slice()
    .sort((a, b) => a - b)
    .map((h) => `${String(h).padStart(2, "0")}:00`)
    .join(", ");
}

function nextLabel(cfg: ChannelBroadcast): string {
  if (!cfg.nextAt || !cfg.nextLabel) return "Sin posts listos para enviar (falta enlace o están en pausa).";
  return `Próximo: ${cfg.nextLabel} · ${madridFmt.format(new Date(cfg.nextAt))} (hora de España)`;
}

function PostEditor({
  channelId,
  index,
  post,
  onChange,
  onError,
}: {
  channelId: string;
  index: number;
  post: BroadcastPost;
  onChange: (cfg: ChannelBroadcast) => void;
  onError: (err: unknown) => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [url, setUrl] = useState(post.url);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<ChannelBroadcast>) {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await fn());
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await run(() => api.channelBroadcasts.uploadImage(channelId, index, file));
  }

  return (
    <div className="yk-card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{post.label}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={post.enabled}
            disabled={busy}
            onChange={(e) =>
              run(() => api.channelBroadcasts.updatePost(channelId, index, { enabled: e.target.checked }))
            }
          />
          <span style={{ fontSize: 13, color: "var(--ink-500)" }}>{post.enabled ? "Activo" : "En pausa"}</span>
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 12 }}>
        Horario (hora de España): {scheduleLabel(post.hours)}
      </div>

      <div className="yk-field" style={{ marginBottom: 10 }}>
        <label className="yk-label">Mensaje</label>
        <textarea
          className="yk-textarea"
          rows={2}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="yk-field" style={{ marginBottom: 10 }}>
        <label className="yk-label">Enlace de invitación</label>
        <input
          className="yk-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://t.me/+..."
          disabled={busy}
        />
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 10 }}>
        Sin imagen se envía el enlace con su vista previa. Sube una imagen solo si el enlace no
        genera vista previa: entonces se enviará la imagen en su lugar.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {post.image ? (
          <>
            <img
              src={post.image.url}
              alt={post.image.filename}
              style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }}
            />
            <span style={{ fontSize: 12, color: "var(--ink-500)", flex: 1, overflow: "hidden" }}>
              {post.image.filename}
            </span>
            <button
              type="button"
              className="yk-icon-btn"
              disabled={busy}
              title="Quitar imagen"
              onClick={() => run(() => api.channelBroadcasts.removeImage(channelId, index))}
            >
              {I.close({ size: 18 })}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-500)", flex: 1 }}>Sin imagen de reserva</span>
        )}
        <button type="button" className="yk-btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          {I.photo({ size: 16 })} {post.image ? "Cambiar" : "Subir imagen"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>

      <button
        type="button"
        className="yk-btn"
        disabled={busy}
        onClick={() => run(() => api.channelBroadcasts.updatePost(channelId, index, { caption, url }))}
      >
        {busy ? "Guardando…" : "Guardar post"}
      </button>
    </div>
  );
}

function ButtonEditor({
  channelId,
  button,
  onChange,
  onError,
}: {
  channelId: string;
  button: ChannelBroadcast["button"];
  onChange: (cfg: ChannelBroadcast) => void;
  onError: (err: unknown) => void;
}) {
  const [enabled, setEnabled] = useState(button.enabled);
  const [text, setText] = useState(button.text);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await api.channelBroadcasts.updateButton(channelId, { enabled, text }));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yk-card" style={{ padding: 16 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Botón bajo cada post</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
            Un botón que abre el enlace al pulsarlo (la imagen por sí sola no es un enlace).
          </div>
        </div>
      </label>
      {enabled && (
        <div className="yk-field" style={{ marginBottom: 12 }}>
          <label className="yk-label">Texto del botón</label>
          <input
            className="yk-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={64}
            placeholder="👉 Entrar aquí"
            disabled={busy}
          />
        </div>
      )}
      <button type="button" className="yk-btn" disabled={busy} onClick={save}>
        {busy ? "Guardando…" : "Guardar botón"}
      </button>
    </div>
  );
}

export function ChannelBroadcastScreen() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<ChannelBroadcast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleErr(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearSession();
      navigate("/login", { replace: true });
      return;
    }
    setError(err instanceof Error ? err.message : "error");
  }

  function apply(next: ChannelBroadcast) {
    setCfg(next);
    setError(null);
  }

  useEffect(() => {
    if (!channelId) return;
    api.channelBroadcasts.get(channelId).then(apply).catch(handleErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  async function sendNow() {
    if (!channelId || busy) return;
    setBusy(true);
    try {
      apply(await api.channelBroadcasts.sendNow(channelId));
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar
        title={cfg ? `Difusión · ${cfg.channelName || "Canal"}` : "Difusión"}
        onBack={() => navigate("/chats")}
      />
      <div className="yk-scroll yk-pad-nav">
        {error && (
          <div className="yk-section">
            <div className="yk-banner" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        )}

        {!cfg ? (
          <div className="yk-section">
            <div className="yk-card">
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            </div>
          </div>
        ) : (
          <>
            <div className="yk-section">
              <div className="yk-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 12 }}>{nextLabel(cfg)}</div>
                <button type="button" className="yk-btn" disabled={busy} onClick={sendNow}>
                  {I.arrowR({ size: 16 })} {busy ? "Enviando…" : "Enviar ahora"}
                </button>
              </div>
            </div>

            <div className="yk-section">
              <div className="yk-section-label">BOTÓN</div>
              <ButtonEditor
                channelId={channelId!}
                button={cfg.button}
                onChange={apply}
                onError={handleErr}
              />
            </div>

            <div className="yk-section">
              <div className="yk-section-label">POSTS</div>
              {cfg.posts.map((p, i) => (
                <PostEditor
                  key={p.key}
                  channelId={channelId!}
                  index={i}
                  post={p}
                  onChange={apply}
                  onError={handleErr}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
