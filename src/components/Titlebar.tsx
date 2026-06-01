import { invoke } from "@tauri-apps/api/core";

interface Props {
  unlocked: boolean;
  onLock: () => void;
}

export default function Titlebar({ unlocked, onLock }: Props) {
  async function handleLock() {
    await invoke("lock_vault");
    onLock();
  }

  return (
    <header
      style={{
        background: "var(--c-surface-1)",
        borderBottom: "1px solid var(--c-border)",
      }}
      className="flex items-center justify-between px-4 h-11 shrink-0 select-none"
    >
      {/* Left: logo + name */}
      <div className="flex items-center gap-2.5">
        <ShieldIcon />
        <span style={{ color: "var(--c-text-1)" }} className="font-semibold tracking-tight text-sm">
          Vault
        </span>
      </div>

      {/* Right: vault status + lock button */}
      <div className="flex items-center gap-3">
        {/* Status badge */}
        <div
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
          style={{
            background: unlocked
              ? "rgba(74, 222, 128, 0.12)"
              : "rgba(248, 113, 113, 0.12)",
            color: unlocked ? "var(--c-success)" : "var(--c-danger)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: unlocked ? "var(--c-success)" : "var(--c-danger)",
            }}
          />
          {unlocked ? "Unlocked" : "Locked"}
        </div>

        {/* Lock button — only visible when unlocked */}
        {unlocked && (
          <button
            onClick={handleLock}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-all duration-150"
            style={{
              background: "var(--c-surface-3)",
              color: "var(--c-text-2)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-1)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--c-surface-3)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-2)";
            }}
          >
            <LockIcon />
            Lock
          </button>
        )}
      </div>
    </header>
  );
}

/* ── Inline SVG icons ────────────────────────────────────────────────────── */

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
