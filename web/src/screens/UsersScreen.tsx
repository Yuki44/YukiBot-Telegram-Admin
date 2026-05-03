import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { StatusPills } from "../components/StatusPills";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { avClass, initials } from "../lib/utils";
import type { UserListFilter, UserRecord } from "../types/api";

const FILTERS: { id: UserListFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "warned", label: "Avisados" },
  { id: "silenced", label: "Silenciados" },
  { id: "banned", label: "Baneados" },
];

function UserDisplayName(u: UserRecord): string {
  return u.name?.trim() || u.username?.trim() || `ID ${u.userId}`;
}

export function UsersScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [filter, setFilter] = useState<UserListFilter>("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) return;
    setUsers(null);
    setError(null);
    const handle = setTimeout(() => {
      api.users
        .list(chatId, { filter, q: q.trim() || undefined })
        .then(setUsers)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            clearSession();
            navigate("/login", { replace: true });
            return;
          }
          setError(err instanceof Error ? err.message : "error");
        });
    }, 200);

    return () => clearTimeout(handle);
  }, [chatId, filter, q, navigate]);

  const titleSuffix = chat ? ` · ${chat.name}` : "";

  return (
    <div className="yk" style={{ minHeight: "100vh" }}>
      <AppBar title={`Usuarios${titleSuffix}`} onBack={() => navigate(`/chats/${chatId}`)} />

      <div className="yk-search">
        {I.search({ size: 18, stroke: "var(--ink-400)" })}
        <input
          placeholder="Buscar @usuario, nombre o ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="yk-segmented">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 16px 16px" }}>
          <div className="yk-banner" style={{ margin: 0 }}>
            {I.help({ size: 18 })}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Solo usuarios vistos</div>
              Telegram no permite a los bots listar miembros de un grupo. Aquí solo aparecen los
              usuarios que <b>han escrito al menos una vez</b> mientras YukiBot estaba presente.
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

        {users === null && !error && (
          <div style={{ padding: 24, color: "var(--ink-500)" }}>Cargando…</div>
        )}

        {users && (
          <div className="yk-section">
            <div className="yk-card">
              {users.length === 0 && (
                <div className="yk-empty">
                  <div className="yk-empty-icon">{I.users({ size: 28 })}</div>
                  <div className="yk-empty-title">Sin resultados</div>
                  <div>Prueba con otro filtro o nombre.</div>
                </div>
              )}
              {users.map((u) => {
                const display = UserDisplayName(u);
                const noName = !u.name?.trim() && !u.username?.trim();
                const hasIssues = u.isBanned || u.isMuted || u.warnings > 0;
                return (
                  <button
                    key={u.userId}
                    className="yk-row"
                    onClick={() => navigate(`/chats/${chatId}/users/${u.userId}`)}
                  >
                    <div className={`yk-avatar ${avClass(display)}`}>
                      {noName ? "?" : initials(display)}
                    </div>
                    <div className="yk-row-body">
                      <div
                        className="yk-row-title"
                        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                      >
                        {noName ? (
                          <span style={{ color: "var(--ink-500)", fontStyle: "italic" }}>
                            Sin nombre
                          </span>
                        ) : (
                          display
                        )}
                        {u.isAdmin && <span className="yk-chip">Admin</span>}
                      </div>
                      <div
                        className="yk-row-sub"
                        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                      >
                        {u.username ? (
                          <span>@{u.username.replace(/^@/, "")}</span>
                        ) : (
                          <span
                            className="yk-mono"
                            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                          >
                            ID {u.userId}
                          </span>
                        )}
                      </div>
                    </div>
                    {hasIssues && (
                      <div className="yk-row-trail" style={{ maxWidth: 140 }}>
                        <StatusPills user={u} compact />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
