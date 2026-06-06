import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useConfirm } from "./ConfirmDialog";
import i18n from "../i18n/index";

// ── localStorage keys ─────────────────────────────────────────────────────────
export const THEME_KEY    = "vaguard_theme";
export const LOCK_KEY     = "vaguard_lock_timeout";
export const GEN_KEY      = "vaguard_gen_defaults";
export const LANG_KEY     = "vaguard_language";

export type Theme = "dark" | "light" | "system";

export interface GenDefaults {
  length:  number;
  upper:   boolean;
  numbers: boolean;
  symbols: boolean;
}

export const DEFAULT_GEN: GenDefaults = { length: 20, upper: true, numbers: true, symbols: true };

export function loadGenDefaults(): GenDefaults {
  try {
    const raw = localStorage.getItem(GEN_KEY);
    return raw ? { ...DEFAULT_GEN, ...JSON.parse(raw) } : DEFAULT_GEN;
  } catch {
    return DEFAULT_GEN;
  }
}

export function applyTheme(t: Theme) {
  if (t === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", t);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettingsPanel({
  unlocked,
  onClose,
  onEntriesChanged,
  onLockTimeoutChange,
}: {
  unlocked: boolean;
  onClose: () => void;
  onEntriesChanged?: () => void;
  onLockTimeoutChange?: (val: number) => void;
}) {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirm();

  // Appearance
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system"
  );

  // Language
  const [language, setLanguage] = useState<string>(
    () => {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored === "en" || stored === "es") return stored;
      const nav = navigator.language?.toLowerCase() ?? "";
      return nav.startsWith("es") ? "es" : "en";
    }
  );

  // Auto-lock
  const [lockTimeout, setLockTimeout] = useState<number>(
    () => parseInt(localStorage.getItem(LOCK_KEY) || "0")
  );

  // Change password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPws,   setShowPws]   = useState(false);
  const [pwBusy,    setPwBusy]    = useState(false);
  const [pwError,   setPwError]   = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // Generator defaults
  const [genDef, setGenDef] = useState<GenDefaults>(loadGenDefaults);

  // Export/Import
  const [exportBusy,  setExportBusy]  = useState(false);
  const [importBusy,  setImportBusy]  = useState(false);
  const [dataMsg,     setDataMsg]     = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Persist theme
  function handleTheme(themeVal: Theme) {
    setTheme(themeVal);
    localStorage.setItem(THEME_KEY, themeVal);
    applyTheme(themeVal);
  }

  // Persist language
  function handleLanguage(lang: string) {
    setLanguage(lang);
    localStorage.setItem(LANG_KEY, lang);
    i18n.changeLanguage(lang);
  }

  // Persist auto-lock
  function handleLockTimeout(val: number) {
    setLockTimeout(val);
    localStorage.setItem(LOCK_KEY, String(val));
    onLockTimeoutChange?.(val);
  }

  // Persist generator defaults
  function handleGenDef(patch: Partial<GenDefaults>) {
    const next = { ...genDef, ...patch };
    setGenDef(next);
    localStorage.setItem(GEN_KEY, JSON.stringify(next));
  }

  // Change master password
  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    if (newPw.length < 8) {
      setPwError(t("settings.security.error.min_length"));
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t("settings.security.error.mismatch"));
      return;
    }

    const ok = await confirm({
      title: t("settings.security.change_password"),
      message: t("settings.security.change_confirm.message"),
      confirmLabel: t("settings.security.change_confirm.button"),
      variant: "danger",
    });
    if (!ok) return;

    setPwBusy(true);
    try {
      await invoke("change_master_password", {
        currentPassword: currentPw,
        newPassword: newPw,
      });
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(String(err));
    } finally {
      setPwBusy(false);
    }
  }

  // Export vault
  async function handleExport() {
    setExportBusy(true);
    setDataMsg(null);
    try {
      const json = await invoke<string>("export_vault");
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `vaguard-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setDataMsg({ type: "ok", text: t("settings.data.exported") });
    } catch (err) {
      setDataMsg({ type: "err", text: String(err) });
    } finally {
      setExportBusy(false);
    }
  }

  // Import vault
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setDataMsg(null);
    setImportBusy(true);
    try {
      const json  = await file.text();
      const count = await invoke<number>("import_vault", { json });
      setDataMsg({ type: "ok", text: t("settings.data.imported", { count }) });
      onEntriesChanged?.();
    } catch (err) {
      setDataMsg({ type: "err", text: String(err) });
    } finally {
      setImportBusy(false);
    }
  }

  const LOCK_OPTIONS: { i18nKey: string; value: number }[] = [
    { i18nKey: "settings.security.autolock.never", value: 0  },
    { i18nKey: "settings.security.autolock.5",     value: 5  },
    { i18nKey: "settings.security.autolock.15",    value: 15 },
    { i18nKey: "settings.security.autolock.30",    value: 30 },
    { i18nKey: "settings.security.autolock.60",    value: 60 },
  ];

  const GEN_OPTIONS: [string, keyof GenDefaults][] = [
    [t("settings.generator.uppercase"), "upper"],
    [t("settings.generator.numbers"),   "numbers"],
    [t("settings.generator.symbols"),   "symbols"],
  ];

  return (
    <>
      {dialog}

      {/* Backdrop */}
      <div
        style={{
          position: "absolute", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(1px)",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="slide-in-right m-[0.25rem] rounded-lg"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0,
          zIndex: 301,
          width: 420,
          background: "var(--c-surface-1)",
          borderLeft: "1px solid var(--c-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0 px-5 py-4"
          style={{ borderBottom: "1px solid var(--c-border)" }}
        >
          <div className="flex items-center gap-2">
            <GearIcon />
            <span className="text-sm font-semibold" style={{ color: "var(--c-text-1)" }}>
              {t("settings.title")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: "var(--c-text-3)" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-1)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-3)")
            }
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* ── Appearance ─────────────────────────────────────────────── */}
          <Section title={t("settings.appearance.title")} icon={<PaletteIcon />}>
            {/* Theme */}
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                {t("settings.appearance.theme")}
              </label>
              <div className="flex gap-2">
                {(["dark", "light", "system"] as Theme[]).map((themeVal) => (
                  <button
                    key={themeVal}
                    onClick={() => handleTheme(themeVal)}
                    className="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: theme === themeVal ? "var(--c-accent)" : "var(--c-surface-2)",
                      color: theme === themeVal ? "white" : "var(--c-text-2)",
                      border: `1px solid ${theme === themeVal ? "var(--c-accent)" : "var(--c-border)"}`,
                    }}
                  >
                    {t(`settings.appearance.theme.${themeVal}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                {t("settings.appearance.language")}
              </label>
              <select
                value={language}
                onChange={(e) => handleLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--c-surface-2)",
                  color: "var(--c-text-1)",
                  border: "1px solid var(--c-border)",
                }}
                onFocus={(e) =>
                  ((e.target as HTMLSelectElement).style.borderColor = "var(--c-accent)")
                }
                onBlur={(e) =>
                  ((e.target as HTMLSelectElement).style.borderColor = "var(--c-border)")
                }
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </Section>

          {/* ── Security ───────────────────────────────────────────────── */}
          <Section title={t("settings.security.title")} icon={<ShieldSmIcon />}>
            {/* Auto-lock */}
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                {t("settings.security.autolock")}
              </label>
              <div className="flex flex-wrap gap-2">
                {LOCK_OPTIONS.map(({ i18nKey, value }) => (
                  <button
                    key={value}
                    onClick={() => handleLockTimeout(value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: lockTimeout === value ? "var(--c-accent)" : "var(--c-surface-2)",
                      color: lockTimeout === value ? "white" : "var(--c-text-2)",
                      border: `1px solid ${lockTimeout === value ? "var(--c-accent)" : "var(--c-border)"}`,
                    }}
                  >
                    {t(i18nKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Change master password */}
            {unlocked ? (
              <form onSubmit={handleChangePw} className="space-y-3 pt-1">
                <p className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                  {t("settings.security.change_password")}
                </p>

                {pwError && (
                  <p
                    className="text-xs p-2.5 rounded-lg"
                    style={{
                      background: "rgba(248,113,113,0.08)",
                      color: "var(--c-danger)",
                      border: "1px solid rgba(248,113,113,0.2)",
                    }}
                  >
                    {pwError}
                  </p>
                )}
                {pwSuccess && (
                  <p
                    className="text-xs p-2.5 rounded-lg"
                    style={{
                      background: "rgba(74,222,128,0.08)",
                      color: "var(--c-success)",
                      border: "1px solid rgba(74,222,128,0.2)",
                    }}
                  >
                    {t("settings.security.updated")}
                  </p>
                )}

                <PwField
                  label={t("settings.security.current_password")}
                  value={currentPw}
                  onChange={setCurrentPw}
                  show={showPws}
                  onToggle={() => setShowPws((v) => !v)}
                  placeholder={t("settings.security.current_password_placeholder")}
                />
                <PwField
                  label={t("settings.security.new_password")}
                  value={newPw}
                  onChange={setNewPw}
                  show={showPws}
                  onToggle={() => setShowPws((v) => !v)}
                  placeholder={t("settings.security.new_password_placeholder")}
                />
                <PwField
                  label={t("settings.security.confirm_password")}
                  value={confirmPw}
                  onChange={setConfirmPw}
                  show={showPws}
                  onToggle={() => setShowPws((v) => !v)}
                  placeholder={t("settings.security.confirm_password_placeholder")}
                />

                <button
                  type="submit"
                  disabled={pwBusy || !currentPw || !newPw || !confirmPw}
                  className="w-full py-2 rounded-lg text-xs font-semibold"
                  style={{
                    background:
                      pwBusy || !currentPw || !newPw || !confirmPw
                        ? "var(--c-surface-3)"
                        : "rgba(248,113,113,0.15)",
                    color:
                      pwBusy || !currentPw || !newPw || !confirmPw
                        ? "var(--c-text-3)"
                        : "var(--c-danger)",
                    border: "1px solid rgba(248,113,113,0.2)",
                  }}
                >
                  {pwBusy ? t("settings.security.updating") : t("settings.security.save_password")}
                </button>
              </form>
            ) : (
              <p className="text-xs" style={{ color: "var(--c-text-3)" }}>
                {t("settings.security.unlock_hint")}
              </p>
            )}
          </Section>

          {/* ── Password Generator ─────────────────────────────────────── */}
          <Section title={t("settings.generator.title")} icon={<KeyIcon />}>
            <p className="text-xs" style={{ color: "var(--c-text-3)" }}>
              {t("settings.generator.hint")}
            </p>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--c-text-2)" }}>
                <span>{t("settings.generator.length")}</span>
                <span className="font-mono font-semibold" style={{ color: "var(--c-text-1)" }}>
                  {genDef.length}
                </span>
              </div>
              <input
                type="range" min={8} max={64}
                value={genDef.length}
                onChange={(e) => handleGenDef({ length: Number(e.target.value) })}
                className="w-full"
                style={{ accentColor: "var(--c-accent)" }}
              />
              <div className="flex justify-between text-xs" style={{ color: "var(--c-text-3)" }}>
                <span>8</span><span>64</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {GEN_OPTIONS.map(([label, key]) => (
                <label
                  key={key}
                  className="flex items-center gap-1.5 cursor-pointer select-none text-xs"
                  style={{ color: "var(--c-text-2)" }}
                >
                  <input
                    type="checkbox"
                    checked={genDef[key] as boolean}
                    onChange={(e) => handleGenDef({ [key]: e.target.checked })}
                    style={{ accentColor: "var(--c-accent)" }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          {/* ── Data ───────────────────────────────────────────────────── */}
          {unlocked && (
            <Section title={t("settings.data.title")} icon={<DatabaseIcon />}>
              {dataMsg && (
                <p
                  className="text-xs p-2.5 rounded-lg"
                  style={{
                    background: dataMsg.type === "ok"
                      ? "rgba(74,222,128,0.08)"
                      : "rgba(248,113,113,0.08)",
                    color: dataMsg.type === "ok" ? "var(--c-success)" : "var(--c-danger)",
                    border: `1px solid ${dataMsg.type === "ok" ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                  }}
                >
                  {dataMsg.type === "ok" ? "✓ " : ""}{dataMsg.text}
                </p>
              )}

              <DataRow
                title={t("settings.data.export")}
                description={t("settings.data.export_description")}
                buttonLabel={exportBusy ? t("settings.data.export_busy") : t("settings.data.export_button")}
                disabled={exportBusy || importBusy}
                onClick={handleExport}
              />

              <DataRow
                title={t("settings.data.import")}
                description={t("settings.data.import_description")}
                buttonLabel={importBusy ? t("settings.data.import_busy") : t("settings.data.import_button")}
                disabled={exportBusy || importBusy}
                onClick={() => fileRef.current?.click()}
              />

              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
            </Section>
          )}

        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title, icon, children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--c-accent)" }}>{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--c-text-2)" }}>
          {title}
        </h3>
      </div>
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
      >
        {children}
      </div>
    </div>
  );
}

function PwField({
  label, value, onChange, show, onToggle, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pr-10 pl-3 py-2 rounded-lg text-xs outline-none"
          style={{
            background: "var(--c-surface-3)",
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
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          className="absolute right-2.5 top-1/2 -translate-y-1/2"
          style={{ color: "var(--c-text-3)" }}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  );
}

function DataRow({
  title, description, buttonLabel, disabled, onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium" style={{ color: "var(--c-text-1)" }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--c-text-3)" }}>{description}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{
          background: disabled ? "var(--c-surface-3)" : "var(--c-surface-3)",
          color: disabled ? "var(--c-text-3)" : "var(--c-text-2)",
          border: "1px solid var(--c-border)",
          cursor: disabled ? "default" : "pointer",
        }}
        onMouseEnter={(e) => {
          if (!disabled)
            (e.currentTarget as HTMLButtonElement).style.color = "var(--c-text-1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color =
            disabled ? "var(--c-text-3)" : "var(--c-text-2)";
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function ShieldSmIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5l3 3L21 8l-3-3" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
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
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
