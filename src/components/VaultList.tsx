import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DownloadResult, Entry, NewEntry } from "../types";
import EntryForm from "./EntryForm";
import SyncPanel from "./SyncPanel";
import ContextMenu, { type ContextMenuEntry as CtxItem } from "./ContextMenu";
import { useConfirm } from "./ConfirmDialog";

type ActiveView = "list" | "sync";

type CtxMenuState = { x: number; y: number; entry?: Entry } | null;

export default function VaultList({ onLock }: { onLock: () => void }) {
  const [entries, setEntries]           = useState<Entry[]>([]);
  const [search, setSearch]             = useState("");
  const [editing, setEditing]           = useState<Entry | null>(null);
  const [creating, setCreating]         = useState(false);
  const [activeView, setActiveView]     = useState<ActiveView>("list");
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [ctxMenu, setCtxMenu]           = useState<CtxMenuState>(null);
  const [revealEntry, setRevealEntry]   = useState<Entry | null>(null);
  const searchRef                       = useRef<HTMLInputElement>(null);
  const { confirm: showConfirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => { loadEntries(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function loadEntries() {
    try {
      setEntries(await invoke<Entry[]>("get_entries"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: number) {
    try {
      await invoke("delete_entry", { id });
      setEditing(null);
      await loadEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLock() {
    try {
      await invoke("lock_vault");
      onLock();
    } catch (e) {
      setError(String(e));
    }
  }

  /** Build context menu items depending on whether an entry was right-clicked */
  function buildCtxItems(entry?: Entry): CtxItem[] {
    const general: CtxItem[] = [
      {
        type: "action",
        label: "New entry",
        icon: <CtxPlusIcon />,
        onClick: () => { setEditing(null); setCreating(true); setActiveView("list"); },
      },
      {
        type: "action",
        label: "Cloud sync",
        icon: <SyncIcon />,
        onClick: () => { setActiveView("sync"); setEditing(null); setCreating(false); },
      },
      {
        type: "action",
        label: "Lock vault",
        icon: <CtxLockIcon />,
        onClick: handleLock,
      },
    ];

    if (!entry) return general;

    return [
      {
        type: "action",
        label: "Copy password",
        icon: <CopyIcon />,
        onClick: () => navigator.clipboard.writeText(entry.password),
      },
      {
        type: "action",
        label: "Show password",
        icon: <CtxEyeIcon />,
        onClick: () => setRevealEntry(entry),
      },
      {
        type: "action",
        label: "Delete entry",
        icon: <CtxTrashIcon />,
        variant: "danger",
        onClick: async () => {
          const ok = await showConfirm({
            title: `Delete "${entry.title}"`,
            message: "This action is permanent and cannot be undone.",
            confirmLabel: "Delete",
            variant: "danger",
          });
          if (ok) handleDelete(entry.id);
        },
      },
      { type: "divider" },
      ...general,
    ];
  }

  async function handleSave(entry: NewEntry) {
    try {
      if (editing) {
        await invoke("update_entry", { id: editing.id, entry });
      } else {
        await invoke("create_entry", { entry });
      }
      setEditing(null);
      setCreating(false);
      await loadEntries();
    } catch (e) {
      setError(String(e));
    }
  }

  const conflictCount = entries.filter((e) => e.conflict).length;

  const filtered = entries.filter((e) => {
    const matchesSearch =
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.username.toLowerCase().includes(search.toLowerCase());
    return showConflictsOnly ? matchesSearch && e.conflict : matchesSearch;
  });

  return (
    <div
      className="flex"
      style={{ height: "100%", overflow: "hidden" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 rounded-lg m-[0.50rem] mr-[0.25rem]"
        style={{
          width: 260,
          borderRight: "1px solid var(--c-border)",
          background: "var(--c-surface-1)",
        }}
      >
        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: "var(--c-surface-2)",
                color: "var(--c-text-1)",
                border: "1px solid var(--c-border)",
              }}
              onFocus={(e) =>
                ((e.target as HTMLInputElement).style.borderColor = "var(--c-accent)")
              }
              onBlur={(e) =>
                ((e.target as HTMLInputElement).style.borderColor = "var(--c-border)")
              }
            />
          </div>
        </div>

        {/* Conflict filter bar */}
        {showConflictsOnly && (
          <div
            className="mx-3 mb-2 px-2 py-1.5 rounded-lg flex items-center justify-between"
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.25)",
            }}
          >
            <span className="text-xs" style={{ color: "var(--c-danger)" }}>
              Showing conflicts only
            </span>
            <button
              onClick={() => setShowConflictsOnly(false)}
              className="text-xs ml-1"
              style={{ color: "var(--c-danger)", opacity: 0.7 }}
              title="Clear filter"
            >
              ✕
            </button>
          </div>
        )}

        {/* Count */}
        <div className="px-3 pb-2 text-xs" style={{ color: "var(--c-text-3)" }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {conflictCount > 0 && !showConflictsOnly && (
            <button
              onClick={() => setShowConflictsOnly(true)}
              className="ml-2"
              style={{ color: "var(--c-danger)", textDecoration: "underline" }}
              title="Filter to conflict entries"
            >
              {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        {/* List */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filtered.map((entry) => (
            <SidebarItem
              key={entry.id}
              entry={entry}
              active={editing?.id === entry.id}
              onSelect={() => { setEditing(entry); setActiveView("list"); }}
              onContextMenu={(e, en) => {
                setCtxMenu({ x: e.clientX, y: e.clientY, entry: en });
              }}
            />
          ))}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center pt-10 pb-4 px-4 text-center">
              <span style={{ fontSize: 32 }}>🔍</span>
              <p className="text-xs mt-2" style={{ color: "var(--c-text-3)" }}>
                {search
                  ? "No entries match your search"
                  : showConflictsOnly
                  ? "No conflict entries"
                  : "No entries yet"}
              </p>
            </div>
          )}
        </nav>

        {/* Sync nav button */}
        <div className="p-2" style={{ borderTop: "1px solid var(--c-border)" }}>
          <button
            onClick={() => {
              setActiveView((v) => v === "sync" ? "list" : "sync");
              setEditing(null);
              setCreating(false);
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs transition-colors"
            style={{
              background: activeView === "sync" ? "var(--c-surface-3)" : "transparent",
              color: activeView === "sync" ? "var(--c-text-1)" : "var(--c-text-2)",
            }}
          >
            <SyncIcon />
            Cloud sync
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden m-[0.5rem] ml-[0.25rem] rounded-lg" style={{ background: "var(--c-bg)" }}>
        {error && (
          <div
            className="m-4 p-3 rounded-lg text-sm"
            style={{
              background: "rgba(248,113,113,0.1)",
              color: "var(--c-danger)",
              border: "1px solid rgba(248,113,113,0.2)",
            }}
          >
            {error}
          </div>
        )}

        {/* Sync panel */}
        {activeView === "sync" && (
          <SyncPanel
            onDownloadComplete={(result: DownloadResult) => {
              loadEntries();
              if (result.conflicts === 0) {
                setTimeout(() => setActiveView("list"), 1800);
              }
            }}
            onShowConflicts={() => {
              setShowConflictsOnly(true);
              setActiveView("list");
            }}
          />
        )}

        {/* List view */}
        {activeView === "list" && (
          <>
            {!editing && !creating && (
              <EmptyDetail hasEntries={entries.length > 0} />
            )}

            {(editing || creating) && (
              <EntryForm
                key={editing?.id ?? "new"}
                initial={editing ?? undefined}
                onSave={handleSave}
                onCancel={() => { setEditing(null); setCreating(false); }}
                onDelete={editing ? () => handleDelete(editing.id) : undefined}
                onConflictResolved={() => {
                  loadEntries();
                  setEditing(null);
                }}
              />
            )}
          </>
        )}

        {/* FAB — only when no panel is open */}
        {activeView === "list" && !creating && !editing && (
          <button
            onClick={() => { setEditing(null); setCreating(true); }}
            className="absolute bottom-6 right-6 flex items-center justify-center rounded-full shadow-lg transition-all duration-150"
            style={{
              width: 48,
              height: 48,
              background: "var(--c-accent)",
              color: "white",
              fontSize: 24,
              lineHeight: 1,
            }}
            title="New entry"
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "var(--c-accent-h)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "var(--c-accent)")
            }
          >
            +
          </button>
        )}
      </div>

      {/* ── Custom context menu ──────────────────────────────────────────── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* ── Reveal-password overlay ──────────────────────────────────────── */}
      {revealEntry && (
        <RevealPasswordOverlay
          entry={revealEntry}
          onClose={() => setRevealEntry(null)}
        />
      )}

      {/* ── Confirm dialogs (context menu delete) ───────────────────────── */}
      {confirmDialog}
    </div>
  );
}

/* ── Sidebar item ─────────────────────────────────────────────────────────── */

function SidebarItem({
  entry,
  active,
  onSelect,
  onContextMenu,
}: {
  entry: Entry;
  active: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent, entry: Entry) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyPassword(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(entry.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // prevent root div handler
        onContextMenu(e, entry);
      }}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left group transition-colors duration-100"
      style={{
        background: active ? "var(--c-surface-3)" : "transparent",
        color: "var(--c-text-1)",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.background = "var(--c-surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {/* Avatar with conflict dot */}
      <div className="relative shrink-0">
        <Avatar title={entry.title} />
        {entry.conflict && (
          <span
            title="Esta entrada tiene un conflicto con la versión en la nube"
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--c-danger)",
              border: "2px solid var(--c-surface-1)",
              display: "block",
            }}
          />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--c-text-1)" }}>
          {entry.title}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--c-text-2)" }}>
          {entry.username || "—"}
        </p>
      </div>

      {/* Copy button */}
      <span
        role="button"
        onClick={copyPassword}
        className="shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150"
        style={{
          color: copied ? "var(--c-success)" : "var(--c-text-3)",
          background: "var(--c-surface-3)",
        }}
        title={copied ? "Copied!" : "Copy password"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
    </button>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */

const AVATAR_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#06b6d4",
];

function Avatar({ title }: { title: string }) {
  const idx = (title.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  const bg  = AVATAR_COLORS[idx];
  const letter = title.charAt(0).toUpperCase();

  return (
    <span
      className="flex items-center justify-center rounded-lg text-white font-semibold text-sm"
      style={{ width: 32, height: 32, background: bg, opacity: 0.9 }}
    >
      {letter}
    </span>
  );
}

/* ── Empty detail state ──────────────────────────────────────────────────── */

function EmptyDetail({ hasEntries }: { hasEntries: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-3 fade-in"
      style={{ color: "var(--c-text-3)" }}
    >
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 8.5V3M12 21v-4.5M8.5 12H3M21 12h-4.5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
      <p className="text-sm" style={{ opacity: 0.6 }}>
        {hasEntries ? "Select an entry to edit" : "Add your first entry with +"}
      </p>
    </div>
  );
}

/* ── Reveal password overlay ─────────────────────────────────────────────── */

function RevealPasswordOverlay({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    await navigator.clipboard.writeText(entry.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        zIndex:          150,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        background:      "rgba(0,0,0,0.45)",
        backdropFilter:  "blur(2px)",
        animation:       "fadeIn 0.12s ease",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:   "var(--c-surface-1)",
          border:       "1px solid var(--c-border)",
          borderRadius: 14,
          padding:      "20px 22px 18px",
          width:        340,
          maxWidth:     "calc(100vw - 48px)",
          boxShadow:    "0 20px 60px rgba(0,0,0,0.4)",
          animation:    "slideUp 0.14s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--c-text-1)" }}>
              {entry.title}
            </p>
            {entry.username && (
              <p className="text-xs mt-0.5" style={{ color: "var(--c-text-3)" }}>
                {entry.username}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ color: "var(--c-text-3)", padding: 4 }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-1)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-3)")
            }
          >
            <RevealCloseIcon />
          </button>
        </div>

        {/* Password display */}
        <div
          style={{
            background:   "var(--c-surface-2)",
            border:       "1px solid var(--c-border)",
            borderRadius: 8,
            padding:      "10px 12px",
            fontFamily:   "monospace",
            fontSize:     14,
            color:        "var(--c-text-1)",
            wordBreak:    "break-all",
            lineHeight:   1.6,
            userSelect:   "text",
          }}
        >
          {entry.password}
        </div>

        {/* Copy button */}
        <button
          onClick={copy}
          style={{
            marginTop:    10,
            width:        "100%",
            padding:      "8px 0",
            borderRadius: 8,
            fontSize:     13,
            fontWeight:   500,
            background:   copied ? "rgba(74,222,128,0.12)" : "var(--c-surface-3)",
            color:        copied ? "var(--c-success)" : "var(--c-text-2)",
            border:       `1px solid ${copied ? "rgba(74,222,128,0.25)" : "var(--c-border)"}`,
            cursor:       "pointer",
            transition:   "all 0.15s",
          }}
        >
          {copied ? "✓ Copied!" : "Copy to clipboard"}
        </button>

        <p
          className="text-center mt-2 text-xs"
          style={{ color: "var(--c-text-3)", opacity: 0.6 }}
        >
          Click outside or press Esc to close
        </p>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </div>
  );
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}

/* ── Context-menu–specific icons (16px) ─────────────────────────────────── */

function CtxPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5"  y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CtxLockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CtxEyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CtxTrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function RevealCloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6"  y2="18" />
      <line x1="6"  y1="6" x2="18" y2="18" />
    </svg>
  );
}
