import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DownloadResult, SyncStatus } from "../types";

const EMAIL_NOT_CONFIRMED = "__email_not_confirmed__";
const COOLDOWN_SECS = 5;

export default function SyncPanel({
  onDownloadComplete,
  onShowConflicts,
}: {
  onDownloadComplete: (result: DownloadResult) => void;
  onShowConflicts: () => void;
}) {
  const [status, setStatus]       = useState<SyncStatus | null>(null);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);

  // Safety countdown — prevents accidental clicks on entry
  const [cooldown, setCooldown]   = useState(COOLDOWN_SECS);

  // Setup form state
  const [formUrl, setFormUrl]       = useState("");
  const [formKey, setFormKey]       = useState("");
  const [formEmail, setFormEmail]   = useState("");
  const [formPw, setFormPw]         = useState("");
  const [showFormPw, setShowFormPw] = useState(false);

  // Login form
  const [loginPw, setLoginPw]         = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Download modal
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadMasterPw, setDownloadMasterPw]   = useState("");
  const [showDownloadPw, setShowDownloadPw]       = useState(false);

  useEffect(() => { loadStatus(); }, []);

  // Countdown tick
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function loadStatus() {
    setLoading(true);
    try {
      setStatus(await invoke<SyncStatus>("sync_get_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setSuccess(null);
    setDownloadResult(null);
    setBusy(label);
    try {
      await fn();
      await loadStatus();
      setSuccess(`${label} completed.`);
    } catch (e) {
      setError(friendlyError(String(e)));
    } finally {
      setBusy(null);
    }
  }

  function friendlyError(raw: string): string {
    if (raw.toLowerCase().includes("email not confirmed")) return EMAIL_NOT_CONFIRMED;
    return raw;
  }

  async function handleConfigure(e: React.FormEvent) {
    e.preventDefault();
    await run("Connecting", () =>
      invoke("sync_configure", {
        url: formUrl.trim(),
        anonKey: formKey.trim(),
        email: formEmail.trim(),
        supabasePassword: formPw,
      })
    );
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    await run("Signing in", () =>
      invoke("sync_login", { supabasePassword: loginPw })
    );
  }

  async function handleUpload() {
    await run("Uploading", () => invoke("sync_upload"));
  }

  function handleDownload() {
    setDownloadMasterPw("");
    setShowDownloadPw(false);
    setDownloadModalOpen(true);
  }

  async function handleDownloadConfirm(e: React.FormEvent) {
    e.preventDefault();
    setDownloadModalOpen(false);
    setError(null);
    setSuccess(null);
    setDownloadResult(null);
    setBusy("Downloading");
    try {
      const result = await invoke<DownloadResult>("sync_download", {
        masterPassword: downloadMasterPw,
      });
      await loadStatus();

      const addedLabel = `${result.added} ${result.added === 1 ? "entry" : "entries"} added`;
      const conflictLabel = result.conflicts > 0
        ? `, ${result.conflicts} conflict${result.conflicts !== 1 ? "s" : ""} detected`
        : "";
      setSuccess(`✓ ${addedLabel}${conflictLabel}`);
      setDownloadResult(result);
      onDownloadComplete(result);
    } catch (e) {
      setError(friendlyError(String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Remove Supabase configuration and sign out?")) return;
    await run("Disconnecting", async () => { await invoke("sync_clear_config"); });
  }

  async function handleLogout() {
    await run("Signing out", () => invoke("sync_logout"));
  }

  function handleShowConflicts() {
    setDownloadResult(null);
    setSuccess(null);
    onShowConflicts();
  }

  const syncDisabled = cooldown > 0 || !!busy;
  const uploadLabel  = cooldown > 0 ? `Sync now (${cooldown}s)` : "Sync now (upload)";
  const downloadLabel = cooldown > 0 ? `Download (${cooldown}s)` : "Download from cloud";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <>
    {/* ── Download master-password modal ──────────────────────────────── */}
    {downloadModalOpen && (
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onClick={() => setDownloadModalOpen(false)}
      >
        <form
          onSubmit={handleDownloadConfirm}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--c-surface-1)",
            border: "1px solid var(--c-border)",
            borderRadius: 16,
            padding: "24px 28px",
            width: 340,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--c-text-1)" }}>
              Download from cloud
            </p>
            <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
              New cloud entries will be added to your local vault. Conflicting
              entries will be flagged for review — nothing is deleted automatically.
              Enter your <strong>master password</strong> so VaGuard can decrypt
              the cloud vault.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
              Master password <span style={{ color: "var(--c-danger)" }}>*</span>
            </label>
            <div className="relative">
              <input
                autoFocus
                type={showDownloadPw ? "text" : "password"}
                value={downloadMasterPw}
                onChange={(e) => setDownloadMasterPw(e.target.value)}
                required
                placeholder="Enter master password"
                className="w-full pr-10 pl-3 py-2 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--c-surface-2)",
                  color: "var(--c-text-1)",
                  border: "1px solid var(--c-border)",
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowDownloadPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: "var(--c-text-3)" }}
              >
                <EyeIcon open={showDownloadPw} />
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDownloadModalOpen(false)}
              className="flex-1 py-2 rounded-lg text-xs"
              style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "var(--c-accent)", color: "white" }}
            >
              Merge &amp; download
            </button>
          </div>
        </form>
      </div>
    )}

    <div
      className="h-full overflow-y-auto px-8 py-6 fade-in"
      style={{ maxWidth: 560, margin: "0 auto" }}
    >
      <h2
        className="text-base font-semibold mb-1"
        style={{ color: "var(--c-text-1)" }}
      >
        Cloud sync
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--c-text-2)" }}>
        Zero-knowledge — your data is encrypted before it leaves your device.
        This app has no servers of its own.
      </p>

      {/* Error / success banners */}
      {error && (
        error === EMAIL_NOT_CONFIRMED
          ? <EmailNotConfirmedBanner />
          : (
            <div
              className="mb-4 p-3 rounded-lg text-xs"
              style={{
                background: "rgba(248,113,113,0.1)",
                color: "var(--c-danger)",
                border: "1px solid rgba(248,113,113,0.2)",
              }}
            >
              {error}
            </div>
          )
      )}
      {success && (
        <div
          className="mb-4 p-3 rounded-lg text-xs flex items-center justify-between gap-2"
          style={{
            background: "rgba(74,222,128,0.1)",
            color: "var(--c-success)",
            border: "1px solid rgba(74,222,128,0.2)",
          }}
        >
          <span>{success}</span>
          {downloadResult && downloadResult.conflicts > 0 && (
            <button
              onClick={handleShowConflicts}
              className="shrink-0 text-xs underline"
              style={{ color: "var(--c-accent)" }}
            >
              View conflicts →
            </button>
          )}
        </div>
      )}

      {/* ── Not configured ─────────────────────────────────────────────── */}
      {!status?.is_configured && (
        <>
          <Steps />
          <form onSubmit={handleConfigure} className="mt-6 space-y-3">
            <SyncField
              label="Supabase Project URL"
              placeholder="https://xxxx.supabase.co"
              value={formUrl}
              onChange={setFormUrl}
              required
            />
            <SyncField
              label="Supabase Anon Key"
              placeholder="eyJhbGci…"
              value={formKey}
              onChange={setFormKey}
              required
            />
            <SyncField
              label="Your email"
              placeholder="you@example.com"
              value={formEmail}
              onChange={setFormEmail}
              type="email"
              required
            />
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                Supabase password <span style={{ color: "var(--c-danger)" }}>*</span>
              </label>
              <p className="text-xs" style={{ color: "var(--c-text-3)" }}>
                This is separate from your master password and stored in your Supabase project.
              </p>
              <div className="relative">
                <input
                  type={showFormPw ? "text" : "password"}
                  value={formPw}
                  onChange={(e) => setFormPw(e.target.value)}
                  required
                  className="w-full pr-10 pl-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    background: "var(--c-surface-2)",
                    color: "var(--c-text-1)",
                    border: "1px solid var(--c-border)",
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowFormPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--c-text-3)" }}
                >
                  <EyeIcon open={showFormPw} />
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={!!busy}
              className="w-full py-2 rounded-lg text-xs font-semibold mt-2"
              style={{
                background: busy ? "var(--c-surface-3)" : "var(--c-accent)",
                color: "white",
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy === "Connecting" ? <InlineSpinner label="Connecting…" /> : "Connect and verify"}
            </button>
          </form>
        </>
      )}

      {/* ── Configured but not authenticated ───────────────────────────── */}
      {status?.is_configured && !status.is_authenticated && (
        <div className="space-y-4">
          <ConfigBadge status={status} />
          <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
            Session expired. Enter your Supabase password to continue syncing.
          </p>
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                Supabase password
              </label>
              <div className="relative">
                <input
                  autoFocus
                  type={showLoginPw ? "text" : "password"}
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  required
                  className="w-full pr-10 pl-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    background: "var(--c-surface-2)",
                    color: "var(--c-text-1)",
                    border: "1px solid var(--c-border)",
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowLoginPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--c-text-3)" }}
                >
                  <EyeIcon open={showLoginPw} />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!!busy}
                className="flex-1 py-2 rounded-lg text-xs font-semibold"
                style={{ background: "var(--c-accent)", color: "white" }}
              >
                {busy === "Signing in" ? <InlineSpinner label="Signing in…" /> : "Sign in"}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-3 py-2 rounded-lg text-xs"
                style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
              >
                Disconnect
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Configured and authenticated ───────────────────────────────── */}
      {status?.is_configured && status.is_authenticated && (
        <div className="space-y-5">
          <ConfigBadge status={status} />

          {/* Last synced */}
          <div
            className="p-4 rounded-xl space-y-3"
            style={{ background: "var(--c-surface-1)", border: "1px solid var(--c-border)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                Last synced
              </span>
              <span className="text-xs font-mono" style={{ color: "var(--c-text-1)" }}>
                {status.last_sync_timestamp > 0
                  ? new Date(status.last_sync_timestamp * 1000).toLocaleString()
                  : "Never"}
              </span>
            </div>
            {cooldown > 0 && (
              <p className="text-xs" style={{ color: "var(--c-text-3)" }}>
                Buttons available in {cooldown}s…
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <SyncActionButton
              label={uploadLabel}
              description="Encrypt and upload your local vault to the cloud"
              icon="↑"
              color="var(--c-accent)"
              busy={busy === "Uploading"}
              busyLabel="Uploading…"
              onClick={handleUpload}
              disabled={syncDisabled}
            />
            <SyncActionButton
              label={downloadLabel}
              description="Merge cloud entries into your local vault"
              icon="↓"
              color="var(--c-warn)"
              busy={busy === "Downloading"}
              busyLabel="Downloading…"
              onClick={handleDownload}
              disabled={syncDisabled}
              warn
            />
          </div>

          {/* Danger zone */}
          <div
            className="p-4 rounded-xl space-y-2"
            style={{
              border: "1px solid rgba(248,113,113,0.2)",
              background: "rgba(248,113,113,0.04)",
            }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--c-danger)" }}>
              Danger zone
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleLogout}
                disabled={!!busy}
                className="flex-1 py-2 rounded-lg text-xs"
                style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
              >
                Sign out
              </button>
              <button
                onClick={handleDisconnect}
                disabled={!!busy}
                className="flex-1 py-2 rounded-lg text-xs font-medium"
                style={{ background: "rgba(248,113,113,0.15)", color: "var(--c-danger)" }}
              >
                {busy === "Disconnecting"
                  ? <InlineSpinner label="Removing…" />
                  : "Unlink account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Steps() {
  return (
    <ol className="space-y-3">
      {[
        {
          n: 1,
          text: "Create a free project at ",
          link: "https://supabase.com",
          linkLabel: "supabase.com",
        },
        {
          n: 2,
          text: "Copy your Project URL and anon key from ",
          link: "https://supabase.com/dashboard/project/_/settings/api",
          linkLabel: "Settings → API",
        },
        {
          n: 3,
          text: "Create a private Storage bucket named ",
          code: "vaults",
          extra: " with RLS enabled.",
        },
      ].map(({ n, text, link, linkLabel, code, extra }) => (
        <li key={n} className="flex gap-3 items-start">
          <span
            className="flex items-center justify-center rounded-full shrink-0 text-xs font-bold"
            style={{
              width: 22,
              height: 22,
              background: "var(--c-surface-3)",
              color: "var(--c-accent)",
              marginTop: 1,
            }}
          >
            {n}
          </span>
          <p className="text-xs leading-relaxed" style={{ color: "var(--c-text-2)" }}>
            {text}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--c-accent)" }}
              >
                {linkLabel}
              </a>
            )}
            {code && (
              <code
                className="px-1 py-0.5 rounded text-xs"
                style={{ background: "var(--c-surface-3)", color: "var(--c-text-1)" }}
              >
                {code}
              </code>
            )}
            {extra}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ConfigBadge({ status }: { status: SyncStatus }) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          background: status.is_authenticated ? "var(--c-success)" : "var(--c-warn)",
        }}
      />
      <div className="min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: "var(--c-text-1)" }}>
          {status.user_email ?? "—"}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--c-text-3)" }}>
          {status.supabase_url_preview ?? "—"}
        </p>
      </div>
      <span
        className="text-xs ml-auto shrink-0"
        style={{ color: status.is_authenticated ? "var(--c-success)" : "var(--c-warn)" }}
      >
        {status.is_authenticated ? "Connected" : "Session expired"}
      </span>
    </div>
  );
}

function SyncActionButton({
  label, description, icon, color, busy, busyLabel, onClick, warn, disabled,
}: {
  label: string;
  description: string;
  icon: string;
  color: string;
  busy: boolean;
  busyLabel: string;
  onClick: () => void;
  warn?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = busy || !!disabled;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
      style={{
        background: "var(--c-surface-1)",
        border: `1px solid ${warn ? "rgba(251,191,36,0.25)" : "var(--c-border)"}`,
        cursor: isDisabled ? "default" : "pointer",
        opacity: isDisabled ? 0.6 : 1,
      }}
    >
      <span
        className="flex items-center justify-center rounded-lg shrink-0 text-base font-bold"
        style={{ width: 32, height: 32, background: `${color}22`, color }}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium" style={{ color: "var(--c-text-1)" }}>
          {busy ? busyLabel : label}
        </p>
        <p className="text-xs" style={{ color: "var(--c-text-3)" }}>
          {description}
        </p>
      </div>
      {busy && <Spinner small />}
    </button>
  );
}

function SyncField({
  label, value, onChange, placeholder, required, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
        {label} {required && <span style={{ color: "var(--c-danger)" }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none"
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
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Spinner({ small }: { small?: boolean }) {
  const s = small ? 14 : 20;
  return (
    <svg
      width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke="var(--c-text-3)" strokeWidth="2.5" strokeLinecap="round"
      style={{ animation: "spin 0.7s linear infinite", flexShrink: 0 }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <Spinner small />
      {label}
    </span>
  );
}

function EmailNotConfirmedBanner() {
  return (
    <div
      className="mb-4 p-4 rounded-xl space-y-3"
      style={{
        background: "rgba(251,191,36,0.08)",
        border: "1px solid rgba(251,191,36,0.25)",
      }}
    >
      <div className="flex items-start gap-2">
        <span style={{ fontSize: 16, lineHeight: 1.2 }}>✉️</span>
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--c-warn)" }}>
            Email not confirmed
          </p>
          <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
            Supabase requires you to verify your email before signing in.
            Choose one of the options below:
          </p>
        </div>
      </div>

      <div className="space-y-2 pl-6">
        <div
          className="p-3 rounded-lg"
          style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: "var(--c-text-1)" }}>
            Option A — Confirm your email (recommended)
          </p>
          <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
            Check your inbox for a confirmation email from Supabase and click the link.
            Then come back here and click <strong>Connect and verify</strong> again.
          </p>
        </div>

        <div
          className="p-3 rounded-lg"
          style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: "var(--c-text-1)" }}>
            Option B — Disable email confirmation in Supabase
          </p>
          <ol className="text-xs space-y-0.5" style={{ color: "var(--c-text-2)" }}>
            <li>1. Open your Supabase project dashboard</li>
            <li>2. Go to <strong>Authentication → Providers → Email</strong></li>
            <li>3. Turn off <strong>"Confirm email"</strong></li>
            <li>4. Click <strong>Connect and verify</strong> again</li>
          </ol>
          <a
            href="https://supabase.com/dashboard/project/_/auth/providers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-xs"
            style={{ color: "var(--c-accent)" }}
          >
            Open Authentication settings →
          </a>
        </div>
      </div>
    </div>
  );
}
