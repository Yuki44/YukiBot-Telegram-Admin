import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppBar } from "../components/AppBar";
import { I } from "../components/Icon";
import { IdentitySubline } from "../components/IdentitySubline";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { StatusPills } from "../components/StatusPills";
import { UserAvatar } from "../components/UserAvatar";
import { ApiError, api } from "../lib/api";
import { clearSession } from "../lib/auth";
import { useChat } from "../lib/useChat";
import { useScrollRestore } from "../lib/useScrollRestore";
import type { UserListFilter, UserRecord } from "../types/api";

// Note: a chat-wide "Sincronizar con Telegram" button used to live here, but it
// fanned out to one getChatMember call per tracked user — easily 1000+ Telegram
// API hits per click, and a fast path to a bot ban. The per-user /refresh on
// UserDetailScreen covers the targeted "verify this user's state" case
// without that risk; new silences/bans are persisted at action time.

const FILTERS: { id: UserListFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "warned", label: "Avisados" },
  { id: "silenced", label: "Silenciados" },
  { id: "banned", label: "Baneados" },
];

function readFilterParam(raw: string | null): UserListFilter {
  if (raw === "warned" || raw === "silenced" || raw === "banned" || raw === "all") return raw;
  return "all";
}

function UserDisplayName(u: UserRecord): string {
  return u.name?.trim() || u.username?.trim() || `ID ${u.userId}`;
}

export function UsersScreen() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const chat = useChat(chatId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [filter, setFilter] = useState<UserListFilter>(() => readFilterParam(searchParams.get("filter")));
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore scroll position when navigating back to this list from a user detail
  // page. Key includes filter+search so each segmented tab keeps its own spot.
  useScrollRestore(
    scrollRef,
    `users:${chatId ?? "_"}:${filter}:${q.trim()}`,
    users !== null
  );

  function changeFilter(next: UserListFilter): void {
    setFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("filter");
    else params.set("filter", next);
    setSearchParams(params, { replace: true });
  }

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
          <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => changeFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="yk-scroll yk-pad-nav">
        <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
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
                    <UserAvatar
                      name={noName ? "" : display}
                      photoFileId={u.photoFileId}
                    />
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
                      <div className="yk-row-sub">
                        <IdentitySubline username={u.username} userId={u.userId} />
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
      <ScrollToTopButton containerRef={scrollRef} />
    </div>
  );
}
