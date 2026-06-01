import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Entry, NewEntry } from "../types";
import EntryForm from "./EntryForm";
import SyncPanel from "./SyncPanel";

type ActiveView = "list" | "sync";

export default function VaultList() {
  const [entries, setEntries]     = useState<Entry[]>([]);
  const [search, setSearch]       = useState("");
  const [editing, setEditing]     = useState<Entry | null>(null);
  const [creating, setCreating]   = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("list");
  const [error, setError]         = useState<string | null>(null);
  const searchRef                 = useRef<HTMLInputElement>(null);

  useEffect(() => { loadEntries(); }, []);

  // Global shortcut: Ctrl+F focuses search
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

  const filtered = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.username.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex" style={{ height: "100%", overflow: "hidden" }}>
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0"
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

        {/* Count */}
        <div className="px-3 pb-2 text-xs" style={{ color: "var(--c-text-3)" }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </div>

        {/* List */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filtered.map((entry) => (
            <SidebarItem
              key={entry.id}
              entry={entry}
              active={editing?.id === entry.id}
              onSelect={() => { setEditing(entry); setActiveView("list"); }}
            />
          ))}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center pt-10 pb-4 px-4 text-center">
              <span style={{ fontSize: 32 }}>🔍</span>
              <p className="text-xs mt-2" style={{ color: "var(--c-text-3)" }}>
                {search ? "No entries match your search" : "No entries yet"}
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
      <div className="flex-1 relative overflow-hidden" style={{ background: "var(--c-bg)" }}>
        {error && (
          <div
            className="m-4 p-3 rounded-lg text-sm"
            style={{ background: "rgba(248,113,113,0.1)", color: "var(--c-danger)", border: "1px solid rgba(248,113,113,0.2)" }}
          >
            {error}
          </div>
        )}

        {/* Sync panel */}
        {activeView === "sync" && <SyncPanel />}

        {/* List view */}
        {activeView === "list" && (
          <>
            {/* Detail / empty state */}
            {!editing && !creating && (
              <EmptyDetail hasEntries={entries.length > 0} />
            )}

            {(editing || creating) && (
              <EntryForm
                key={editing?.id ?? "new"}
                initial={editing ?? undefined}
                onSave={handleSave}
                onCancel={() => { setEditing(null); setCreating(false); }}
              />
            )}
          </>
        )}

        {/* FAB — only when no panel is open */}
        {activeView === "list" && !creating && !editing && <button
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
        </button>}
      </div>
    </div>
  );
}

/* ── Sidebar item ─────────────────────────────────────────────────────────── */

function SidebarItem({
  entry,
  active,
  onSelect,
}: {
  entry: Entry;
  active: boolean;
  onSelect: () => void;
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
      {/* Favicon placeholder */}
      <Avatar title={entry.title} />

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
      className="flex items-center justify-center rounded-lg shrink-0 text-white font-semibold text-sm"
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
