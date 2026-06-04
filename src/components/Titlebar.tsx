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
          VaGuard
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
      <svg width="24" height="24" viewBox="0 0 17 22" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="var(--c-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 20.534C8.5 20.534 16.5 16.534 16.5 10.534V3.534L8.5 0.534L0.5 3.534V10.534C0.5 16.534 8.5 20.534 8.5 20.534Z" />
          <circle cx="6.5" cy="9.534" r="2" />
          <line x1="8.5" y1="9.534" x2="13.5" y2="9.534" />
          <line x1="13" y1="12.034" x2="13" y2="10.034" />
          <line x1="11" y1="11.534" x2="11" y2="9.534" />
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
