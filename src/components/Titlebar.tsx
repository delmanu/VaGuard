import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  unlocked: boolean;
  onLock: () => void;
}

export default function Titlebar({ unlocked, onLock }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);

    let cleanup: (() => void) | undefined;
    win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    }).then((fn) => { cleanup = fn; });

    return () => cleanup?.();
  }, []);

  /** Start window drag — only on left-click on non-interactive areas */
  function handleDragStart(e: React.MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, select, [role='button']")) return;
    getCurrentWindow().startDragging();
  }

  async function handleLock() {
    await invoke("lock_vault");
    onLock();
  }

  return (
    <header
      onMouseDown={handleDragStart}
      className="flex items-center justify-between shrink-0 select-none"
      style={{
        height: 44,
        background: "var(--c-surface-1)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      {/* ── Left: logo + name ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 h-full">
        <ShieldIcon />
        <span
          className="font-semibold tracking-tight text-sm"
          style={{ color: "var(--c-text-1)" }}
        >
          VaGuard
        </span>
      </div>

      {/* ── Right: status + lock | window controls ───────────────────────── */}
      <div className="flex items-center h-full">

        {/* Status + lock */}
        <div className="flex items-center gap-3 pl-4 pr-3">
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
              style={{ background: unlocked ? "var(--c-success)" : "var(--c-danger)" }}
            />
            {unlocked ? "Unlocked" : "Locked"}
          </div>

          {/* Lock button — only when unlocked */}
          {unlocked && (
            <button
              onClick={handleLock}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors duration-150"
              style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-1)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-2)")
              }
            >
              <LockIcon />
              Lock
            </button>
          )}
        </div>

        {/* Separator */}
        <div
          style={{
            width: 1,
            height: 18,
            background: "var(--c-border)",
            marginLeft: 8,
            marginRight: 4,
            flexShrink: 0,
          }}
        />

        {/* Window controls */}
        <div className="flex h-full">
          <WinBtn
            title="Minimize"
            onClick={() => getCurrentWindow().minimize()}
          >
            <MinimizeIcon />
          </WinBtn>
          <WinBtn
            title={isMaximized ? "Restore" : "Maximize"}
            onClick={() => getCurrentWindow().toggleMaximize()}
          >
            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          </WinBtn>
          <WinBtn
            title="Close"
            onClick={() => getCurrentWindow().close()}
            danger
          >
            <WinCloseIcon />
          </WinBtn>
        </div>

      </div>
    </header>
  );
}

/* ── Window control button ───────────────────────────────────────────────── */

function WinBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 46,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        color: "var(--c-text-3)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        if (danger) {
          el.style.background = "#c42b1c";
          el.style.color = "white";
        } else {
          el.style.background = "var(--c-surface-3)";
          el.style.color = "var(--c-text-1)";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = "transparent";
        el.style.color = "var(--c-text-3)";
      }}
    >
      {children}
    </button>
  );
}

/* ── Window control icons (10 × 10, Windows 11 style) ───────────────────── */

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
      {/* back window */}
      <rect x="3.5" y="0.5" width="7" height="7" />
      {/* front window — fill hides the back's overlap */}
      <rect x="0.5" y="3.5" width="7" height="7" fill="var(--c-surface-1)" />
      <rect x="0.5" y="3.5" width="7" height="7" />
    </svg>
  );
}

function WinCloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" />
      <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" />
    </svg>
  );
}

/* ── App icons ───────────────────────────────────────────────────────────── */

function ShieldIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 17 22" fill="none" xmlns="http://www.w3.org/2000/svg"
      stroke="var(--c-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 20.534C8.5 20.534 16.5 16.534 16.5 10.534V3.534L8.5 0.534L0.5 3.534V10.534C0.5 16.534 8.5 20.534 8.5 20.534Z" />
      <circle cx="6.5" cy="9.534" r="2" />
      <line x1="8.5"  y1="9.534"  x2="13.5" y2="9.534" />
      <line x1="13"   y1="12.034" x2="13"   y2="10.034" />
      <line x1="11"   y1="11.534" x2="11"   y2="9.534" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
