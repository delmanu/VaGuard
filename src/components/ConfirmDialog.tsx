import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/* ── Public types ─────────────────────────────────────────────────────────── */

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders the confirm button in red. Default is accent blue. */
  variant?: "default" | "danger";
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

interface DialogState extends ConfirmOptions {
  resolve: (result: boolean) => void;
}

/**
 * useConfirm() returns:
 *   - `confirm(opts)` — async function that resolves to true/false
 *   - `dialog`        — JSX to render somewhere in the component tree
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   // … render {dialog} anywhere in JSX
 *   if (await confirm({ title: "Delete?", message: "…", variant: "danger" })) { … }
 */
export function useConfirm() {
  const [state, setState] = useState<DialogState | null>(null);

  async function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }

  function settle(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  const dialog = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
}

/* ── ConfirmDialog component ──────────────────────────────────────────────── */

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("confirm.confirm");
  const resolvedCancelLabel  = cancelLabel  ?? t("confirm.cancel");
  const isDanger = variant === "danger";

  /* Keyboard: Escape → cancel, Enter → confirm */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Enter")  { e.preventDefault(); onConfirm(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    /* Backdrop */
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        animation: "fadeIn 0.12s ease",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Card */}
      <div
        style={{
          background: "var(--c-surface-1)",
          border: "1px solid var(--c-border)",
          borderRadius: 16,
          padding: "24px 24px 20px",
          width: 380,
          maxWidth: "calc(100vw - 48px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
          animation: "slideUp 0.15s ease",
        }}
      >
        {/* Icon */}
        <div
          className="mx-auto"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
            background: isDanger
              ? "rgba(248,113,113,0.12)"
              : "rgba(99,102,241,0.12)",
          }}
        >
          {isDanger ? <DangerIcon /> : <InfoIcon />}
        </div>

        {/* Title */}
        {title && (
          <p
            style={{
              color: "var(--c-text-1)",
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {title}
          </p>
        )}

        {/* Message */}
        <p
          style={{
            color: "var(--c-text-2)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 40,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              background: "var(--c-surface-3)",
              color: "var(--c-text-2)",
              border: "1px solid var(--c-border)",
              cursor: "pointer",
              transition: "opacity 0.12s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              background: isDanger ? "var(--c-danger)" : "var(--c-accent)",
              color: "white",
              cursor: "pointer",
              transition: "opacity 0.12s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.85")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>

      {/* Keyframe animations injected once */}
      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(10px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────────────── */

function DangerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="var(--c-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="var(--c-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
