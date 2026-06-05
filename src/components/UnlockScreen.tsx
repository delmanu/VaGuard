import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onUnlocked: () => void;
}

export default function UnlockScreen({ onUnlocked }: Props) {
  const [password, setPassword]     = useState("");
  const [show, setShow]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [attempts, setAttempts]     = useState(0);
  const [shaking, setShaking]       = useState(false);
  const inputRef                    = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await invoke("unlock_vault", { masterPassword: password });
      setPassword("");
      onUnlocked();
    } catch (err) {
      const count = attempts + 1;
      setAttempts(count);
      setError(
        count >= 3
          ? `Wrong password (${count} failed attempts)`
          : "Wrong master password"
      );
      setPassword("");
      // trigger shake
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex items-center justify-center fade-in"
      style={{ height: "100%", background: "var(--c-bg)" }}
    >
      <div style={{ width: "100%", maxWidth: 360 }} className="px-4">
        {/* Lock icon */}
        <div className="flex justify-center mb-8">
          <div
            className="flex items-center justify-center rounded-2xl"
            style={{
              width: 80,
              height: 80,
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
            }}
          >
            <VaultIcon />
          </div>
        </div>

        <h1
          className="text-center font-bold text-xl mb-1"
          style={{ color: "var(--c-text-1)" }}
        >
          VaGuard
        </h1>
        <p
          className="text-center text-sm mb-8"
          style={{ color: "var(--c-text-2)" }}
        >
          Enter your master password to unlock
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Password field */}
          <div className={shaking ? "shake" : ""}>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--c-text-2)" }}
            >
              Master password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                autoFocus
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter master password"
                required
                className="w-full pr-10 pl-3 py-2.5 rounded-lg text-sm outline-none transition-all duration-150"
                style={{
                  background: "var(--c-surface-2)",
                  color: "var(--c-text-1)",
                  border: `1px solid ${error ? "var(--c-danger)" : "var(--c-border)"}`,
                  boxShadow: error
                    ? "0 0 0 3px rgba(248,113,113,0.15)"
                    : "none",
                }}
                onFocus={(e) => {
                  if (!error)
                    (e.target as HTMLInputElement).style.borderColor = "var(--c-accent)";
                }}
                onBlur={(e) => {
                  if (!error)
                    (e.target as HTMLInputElement).style.borderColor = "var(--c-border)";
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShow((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity"
                style={{ color: "var(--c-text-3)" }}
              >
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>

            {/* Error message */}
            {error && (
              <p className="mt-1.5 text-xs" style={{ color: "var(--c-danger)" }}>
                {error}
              </p>
            )}

            {/* Attempt warning */}
            {attempts >= 3 && (
              <p className="mt-1.5 text-xs" style={{ color: "var(--c-warn)" }}>
                Too many failed attempts. Make sure you're using the correct password.
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || password.length === 0}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-150"
            style={{
              background: loading ? "var(--c-surface-3)" : "var(--c-accent)",
              color: "white",
              opacity: password.length === 0 ? 0.5 : 1,
              cursor: password.length === 0 ? "default" : "pointer",
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Unlocking…
              </span>
            ) : (
              "Unlock"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function VaultIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5V3M12 21v-4.5M8.5 12H3M21 12h-4.5" />
      <circle cx="12" cy="12" r="1" fill="var(--c-accent)" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "spin 0.7s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
