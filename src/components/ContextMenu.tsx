import { useEffect, useRef } from "react";

/* ── Public types ─────────────────────────────────────────────────────────── */

export interface ContextMenuAction {
  type: "action";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  shortcut?: string;
}

export interface ContextMenuDivider {
  type: "divider";
}

export type ContextMenuEntry = ContextMenuAction | ContextMenuDivider;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/* ── Constants ────────────────────────────────────────────────────────────── */

const MENU_WIDTH  = 214;
const ITEM_H      = 34;
const DIVIDER_H   = 9;
const PAD         = 8; // top + bottom padding

/* ── ContextMenu ──────────────────────────────────────────────────────────── */

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const estHeight =
    items.reduce((acc, item) =>
      acc + (item.type === "divider" ? DIVIDER_H : ITEM_H), PAD);

  // Clamp so the menu stays fully inside the viewport
  const ax = Math.min(x, window.innerWidth  - MENU_WIDTH  - 8);
  const ay = Math.min(y, window.innerHeight - estHeight   - 8);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() { onClose(); }

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown",   onKey);
    window.addEventListener("scroll",    onScroll, { capture: true, once: true });
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown",   onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position:     "fixed",
        left:         ax,
        top:          ay,
        zIndex:       200,
        width:        MENU_WIDTH,
        background:   "var(--c-surface-1)",
        border:       "1px solid var(--c-border)",
        borderRadius: 10,
        padding:      "4px",
        boxShadow:    "0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15)",
        animation:    "ctxIn 0.1s ease",
        userSelect:   "none",
      }}
    >
      <style>{`
        @keyframes ctxIn {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
      `}</style>

      {items.map((item, i) =>
        item.type === "divider" ? (
          <div
            key={i}
            style={{
              height:     1,
              background: "var(--c-border)",
              margin:     "4px 4px",
            }}
          />
        ) : (
          <ContextMenuButton key={i} item={item} onClose={onClose} />
        )
      )}
    </div>
  );
}

/* ── Single item button ───────────────────────────────────────────────────── */

function ContextMenuButton({
  item,
  onClose,
}: {
  item: ContextMenuAction;
  onClose: () => void;
}) {
  const isDanger = item.variant === "danger";

  return (
    <button
      type="button"
      onClick={() => { item.onClick(); onClose(); }}
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           10,
        width:         "100%",
        padding:       "7px 10px",
        borderRadius:  7,
        fontSize:      13,
        textAlign:     "left",
        color:         isDanger ? "var(--c-danger)" : "var(--c-text-1)",
        background:    "transparent",
        cursor:        "pointer",
        transition:    "background 0.07s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = isDanger
          ? "rgba(248,113,113,0.1)"
          : "var(--c-surface-3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {/* Icon */}
      <span
        style={{
          width:           16,
          height:          16,
          display:         "flex",
          alignItems:      "center",
          justifyContent:  "center",
          flexShrink:      0,
          opacity:         isDanger ? 0.9 : 0.55,
        }}
      >
        {item.icon}
      </span>

      {/* Label */}
      <span style={{ flex: 1 }}>{item.label}</span>

      {/* Shortcut hint */}
      {item.shortcut && (
        <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
          {item.shortcut}
        </span>
      )}
    </button>
  );
}
