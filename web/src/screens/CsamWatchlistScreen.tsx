import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { ApiError, api } from "../lib/api";
import { clearSession, getStoredUser } from "../lib/auth";
import type { CsamWatchCategory, CsamWatchlistData } from "../types/api";

interface CategoryMeta {
  id: CsamWatchCategory;
  name: string;
  desc: string;
  placeholder: string;
}

const CATEGORY_META: CategoryMeta[] = [
  {
    id: "handles",
    name: "Cuentas / handles",
    desc: "Identificadores del vendedor y sus cuentas ALT (p. ej. nomax16). Si aparecen en una bio junto a una palabra de venta → baneo automático en todos los chats.",
    placeholder: "handle sin @ (p. ej. nomax16)",
  },
  {
    id: "solicitation",
    name: "Palabras de venta",
    desc: "Señales de venta/solicitud. Solo activan el baneo automático cuando además hay una cuenta de la lista en la misma bio.",
    placeholder: "palabra o frase de venta",
  },
  {
    id: "negation",
    name: "Palabras que protegen",
    desc: "Si aparecen, se bloquea el baneo automático (p. ej. «no cp», «denuncia»). Protegen a quien va EN CONTRA.",
    placeholder: "palabra anti-CP",
  },
  {
    id: "keywords",
    name: "Palabras clave CP (imágenes)",
    desc: "Indicadores fuertes usados en el OCR de imágenes. Solo silencian para revisión — nunca banean por sí solas.",
    placeholder: "palabra clave",
  },
];

const EMPTY_STORED: CsamWatchlistData["stored"] = {
  handles: [],
  solicitation: [],
  negation: [],
  keywords: [],
};

export function CsamWatchlistScreen() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [data, setData] = useState<CsamWatchlistData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<CsamWatchCategory, string>>({
    handles: "",
    solicitation: "",
    negation: "",
    keywords: "",
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    api.csam
      .getWatchlist()
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          navigate("/login", { replace: true });
          return;
        }
        setError(err instanceof Error ? err.message : "error");
      });
  }, [navigate, user?.isSuperAdmin]);

  if (!user?.isSuperAdmin) {
    return (
      <div className="yk" style={{ minHeight: "100vh" }}>
        <AppBar title="Lista CP / impostor" onBack={() => navigate("/chats")} />
        <div className="yk-scroll yk-pad-nav">
          <div className="yk-section">
            <div className="yk-banner" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              {I.lock({ size: 18 })}
              <div>Solo un super-admin puede ver o editar esta lista.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function add(category: CsamWatchCategory) {
    const value = inputs[category].trim();
    if (!value || busyKey) return;
    setBusyKey(`add:${category}`);
    setError(null);
    try {
      const res = await api.csam.addTerm(category, value);
      setData((prev) => (prev ? { ...prev, stored: res.stored } : prev));
      setInputs((prev) => ({ ...prev, [category]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(category: CsamWatchCategory, value: string) {
    if (busyKey) return;
    setBusyKey(`del:${category}:${value}`);
    setError(null);
    try {
      const res = await api.csam.removeTerm(category, value);
      setData((prev) => (prev ? { ...prev, stored: res.stored } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setBusyKey(null);
    }
  }

  const stored = data?.stored ?? EMPTY_STORED;

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title="Lista CP / impostor" onBack={() => navigate("/chats")} />
      <div className="yk-scroll yk-pad-nav">
        <div className="yk-banner">
          {I.shield({ size: 18 })}
          <div>
            Lista global usada por todos los chats con la detección activada. Las cuentas base van en el
            servidor y no se muestran aquí; añade abajo las variantes que detectes.
          </div>
        </div>

        {error && (
          <div className="yk-section">
            <div className="yk-banner" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              {I.alert({ size: 18 })}
              <div>{error}</div>
            </div>
          </div>
        )}

        {!data ? (
          <div className="yk-section">
            <div className="yk-card">
              <div style={{ padding: 18, color: "var(--ink-500)" }}>Cargando…</div>
            </div>
          </div>
        ) : (
          CATEGORY_META.map((cat) => {
            const rows = stored[cat.id];
            const defaults =
              cat.id === "handles"
                ? []
                : (data.defaults[cat.id as "solicitation" | "negation" | "keywords"] ?? []);
            return (
              <div className="yk-section" key={cat.id}>
                <div className="yk-section-label">{cat.name.toUpperCase()}</div>
                <div className="yk-card" style={{ padding: 14 }}>
                  <div className="yk-row-sub" style={{ whiteSpace: "normal", marginBottom: 10 }}>
                    {cat.desc}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void add(cat.id);
                    }}
                    style={{ display: "flex", gap: 8, marginBottom: rows.length ? 12 : 0 }}
                  >
                    <input
                      className="yk-input"
                      value={inputs[cat.id]}
                      onChange={(e) => setInputs((p) => ({ ...p, [cat.id]: e.target.value }))}
                      placeholder={cat.placeholder}
                      disabled={!!busyKey}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="yk-btn"
                      disabled={!!busyKey || !inputs[cat.id].trim()}
                      style={{ width: "auto", padding: "12px 18px" }}
                    >
                      {I.plus({ size: 16 })}
                    </button>
                  </form>

                  {cat.id === "handles" && data.envHandleCount > 0 && (
                    <div style={{ marginBottom: rows.length ? 12 : 0 }}>
                      <span className="yk-chip">
                        {data.envHandleCount} {data.envHandleCount === 1 ? "cuenta base" : "cuentas base"} en
                        el servidor (ocultas)
                      </span>
                    </div>
                  )}

                  {rows.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {rows.map((term) => (
                        <button
                          key={term}
                          type="button"
                          className="yk-chip"
                          onClick={() => void remove(cat.id, term)}
                          disabled={!!busyKey}
                          title="Quitar"
                          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                        >
                          {term}
                          {I.close({ size: 12 })}
                        </button>
                      ))}
                    </div>
                  )}

                  {defaults.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div
                        className="yk-row-sub"
                        style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11 }}
                      >
                        Incluidas por defecto (siempre activas)
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", opacity: 0.6 }}>
                        {defaults.map((term) => (
                          <span key={term} className="yk-chip">
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
