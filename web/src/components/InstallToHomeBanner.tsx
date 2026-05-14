import { useState } from "react";
import { I } from "./Icon";
import { useInstallPrompt, type InstallPlatform } from "../lib/useInstallPrompt";

const DISMISS_KEY = "yk_install_dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode — best-effort */
  }
}

interface Instructions {
  title: string;
  steps: string[];
  hint?: string;
  /** When true, surface a "Copiar enlace" button so the user can paste it in a real browser. */
  showCopyLink: boolean;
}

function instructionsFor(platform: InstallPlatform): Instructions {
  switch (platform) {
    case "ios-safari":
      return {
        title: "Añadir a pantalla de inicio",
        steps: [
          "Toca el botón Compartir en la barra inferior (un cuadrado con una flecha hacia arriba).",
          "Desplázate y toca «Añadir a pantalla de inicio».",
          "Confirma el nombre y toca «Añadir». YukiBot aparecerá junto a tus apps.",
        ],
        showCopyLink: false,
      };
    case "ios-other":
      return {
        title: "Ábrelo en Safari",
        steps: [
          "Copia el enlace de esta página.",
          "Abre Safari y pega el enlace.",
          "Una vez en Safari, toca Compartir → «Añadir a pantalla de inicio».",
        ],
        hint: "En iPhone solo Safari puede añadir webs a la pantalla de inicio.",
        showCopyLink: true,
      };
    case "android-chrome":
      return {
        title: "Añadir a pantalla de inicio",
        steps: [
          "Toca el menú ⋮ en la esquina superior derecha del navegador.",
          "Elige «Instalar app» o «Añadir a pantalla de inicio».",
          "Confirma y YukiBot aparecerá junto a tus apps.",
        ],
        showCopyLink: false,
      };
    case "android-webview":
      return {
        title: "Ábrelo en tu navegador",
        steps: [
          "Toca el menú ⋮ arriba a la derecha.",
          "Elige «Abrir en navegador» (o «Abrir en Chrome»).",
          "Una vez en Chrome, toca ⋮ → «Instalar app» o «Añadir a pantalla de inicio».",
        ],
        hint: "Estás viéndolo dentro de Telegram. La instalación solo funciona desde un navegador real.",
        showCopyLink: true,
      };
    case "android-other":
      return {
        title: "Añadir a pantalla de inicio",
        steps: [
          "Abre el menú del navegador (suele ser ⋮ o ⋯).",
          "Busca «Añadir a pantalla de inicio» o «Instalar app».",
          "Confirma — YukiBot aparecerá junto a tus apps.",
        ],
        showCopyLink: false,
      };
    default:
      return {
        title: "Añadir a pantalla de inicio",
        steps: ["Abre el menú de tu navegador y busca «Añadir a pantalla de inicio»."],
        showCopyLink: false,
      };
  }
}

/**
 * Always visible on mobile (when not already installed and not dismissed). The click
 * routes to whatever path the environment supports:
 *   - Native prompt queued → call `prompt()`.
 *   - iOS / no event yet / in-app browser → open an instruction sheet tailored to the env.
 */
export function InstallToHomeBanner() {
  const { canInstall, install, isStandalone, platform, isMobile } = useInstallPrompt();
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isMobile || isStandalone || dismissed) return null;

  function dismiss() {
    persistDismissed();
    setDismissed(true);
  }

  async function onAdd() {
    if (busy) return;
    if (canInstall) {
      setBusy(true);
      const outcome = await install();
      setBusy(false);
      if (outcome === "accepted") dismiss();
      else if (outcome === "no-prompt") setSheetOpen(true);
      return;
    }
    setSheetOpen(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* fallback noop — user can copy from the address bar */
    }
  }

  const instr = instructionsFor(platform);

  return (
    <div className="yk-section">
      <div
        className="yk-card"
        style={{
          padding: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--brand-50)",
          border: "1px solid var(--brand-200)",
        }}
      >
        <div
          className="yk-row-icon"
          style={{
            background: "var(--brand-100)",
            color: "var(--brand-700)",
            flexShrink: 0,
            fontSize: 20,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          📲
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Añadir a la pantalla de inicio</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
            Acceso rápido a YukiBot sin abrir el navegador.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button
            type="button"
            className="yk-btn"
            onClick={onAdd}
            disabled={busy}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            {busy ? "…" : "Añadir"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Descartar"
            style={{
              background: "transparent",
              border: 0,
              padding: 6,
              cursor: "pointer",
              color: "var(--ink-500)",
              display: "inline-flex",
            }}
          >
            {I.close({ size: 16 })}
          </button>
        </div>
      </div>

      {sheetOpen && (
        <div className="yk-sheet-overlay" onClick={() => setSheetOpen(false)}>
          <div className="yk-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="yk-sheet-handle" />
            <div style={{ padding: "8px 20px 24px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>{instr.title}</div>
              <ol style={{ paddingLeft: 20, margin: 0, color: "var(--ink-700)", lineHeight: 1.55 }}>
                {instr.steps.map((step, i) => (
                  <li key={i} style={{ marginBottom: 6, fontSize: 14 }}>
                    {step}
                  </li>
                ))}
              </ol>
              {instr.hint && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    background: "var(--bg-sunken)",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "var(--ink-500)",
                    lineHeight: 1.5,
                  }}
                >
                  {instr.hint}
                </div>
              )}
              {instr.showCopyLink && (
                <button
                  type="button"
                  className="yk-btn"
                  style={{
                    marginTop: 14,
                    width: "100%",
                    background: "transparent",
                    color: "var(--brand-700)",
                    border: "1.5px solid var(--brand-200)",
                  }}
                  onClick={copyLink}
                >
                  {copied ? "✓ Enlace copiado" : "Copiar enlace"}
                </button>
              )}
              <button
                type="button"
                className="yk-btn"
                style={{ marginTop: 10, width: "100%" }}
                onClick={() => setSheetOpen(false)}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
