import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Entry, NewEntry } from "../types";
import PasswordGenerator from "./PasswordGenerator";
import { useConfirm } from "./ConfirmDialog";

interface Props {
  initial?: Entry;
  onSave: (entry: NewEntry) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onConflictResolved?: () => void;
}

function isValidUrl(value: string) {
  if (!value) return true;
  try { new URL(value.startsWith("http") ? value : `https://${value}`); return true; }
  catch { return false; }
}

const CONFLICT_FIELDS: { key: keyof NewEntry; i18nKey: string }[] = [
  { key: "title",    i18nKey: "conflict.field.title" },
  { key: "username", i18nKey: "conflict.field.username" },
  { key: "password", i18nKey: "conflict.field.password" },
  { key: "url",      i18nKey: "conflict.field.url" },
  { key: "notes",    i18nKey: "conflict.field.notes" },
];

export default function EntryForm({ initial, onSave, onCancel, onDelete, onConflictResolved }: Props) {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<NewEntry>({
    title:    initial?.title    ?? "",
    username: initial?.username ?? "",
    password: initial?.password ?? "",
    url:      initial?.url      ?? "",
    notes:    initial?.notes    ?? "",
  });
  const [showPw,  setShowPw]  = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [pwCopied, setPwCopied] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof NewEntry, boolean>>>({});

  async function copyPassword() {
    if (!form.password) return;
    await navigator.clipboard.writeText(form.password);
    setPwCopied(true);
    setTimeout(() => setPwCopied(false), 2000);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify({
    title:    initial?.title    ?? "",
    username: initial?.username ?? "",
    password: initial?.password ?? "",
    url:      initial?.url      ?? "",
    notes:    initial?.notes    ?? "",
  });

  function set(field: keyof NewEntry, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  function touch(field: keyof NewEntry) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  const errors = {
    title:    !form.title.trim()                          ? t("entry.error.title_required")    : null,
    url:      touched.url && !isValidUrl(form.url ?? "")  ? t("entry.error.invalid_url")        : null,
    password: !form.password.trim()                       ? t("entry.error.password_required")  : null,
  };
  const isValid = !errors.title && !errors.url && !errors.password;

  async function handleCancel() {
    if (dirty) {
      const ok = await confirm({
        title: t("entry.discard.title"),
        message: t("entry.discard.message"),
        confirmLabel: t("entry.discard.confirm"),
        cancelLabel: t("entry.discard.cancel"),
        variant: "danger",
      });
      if (!ok) return;
    }
    onCancel();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSave(form);
  }

  return (
    <div
      className="slide-in-right flex flex-col h-full"
      style={{
        background: "var(--c-surface-1)",
        borderLeft: "1px solid var(--c-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--c-border)" }}
      >
        <h2 className="font-semibold text-sm" style={{ color: "var(--c-text-1)" }}>
          {initial ? t("entry.title.edit") : t("entry.title.new")}
        </h2>
        <button
          onClick={handleCancel}
          className="p-1.5 rounded-md transition-colors"
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

      {/* Body */}
      <form
        id="entry-form"
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
      >
        <Field
          label={t("entry.field.title")}
          required
          error={touched.title ? errors.title : null}
        >
          <input
            autoFocus
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => touch("title")}
            placeholder={t("entry.placeholder.title")}
            className="form-input"
            style={inputStyle(!!touched.title && !!errors.title)}
          />
        </Field>

        <Field label={t("entry.field.username")}>
          <input
            type="text"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder={t("entry.placeholder.username")}
            className="form-input"
            style={inputStyle(false)}
          />
        </Field>

        {/* Password */}
        <Field label={t("entry.field.password")} required error={touched.password ? errors.password : null}>
          <div className="flex gap-2">
            {/* Input + copy — visually joined */}
            <div className="flex flex-1">
              <div className="relative flex-1">
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  onBlur={() => touch("password")}
                  placeholder={t("entry.placeholder.password")}
                  className="form-input w-full pr-9"
                  style={{
                    ...inputStyle(!!touched.password && !!errors.password),
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    borderRight: "none",
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--c-text-3)" }}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {/* Copy button */}
              <button
                type="button"
                tabIndex={-1}
                onClick={copyPassword}
                title={pwCopied ? t("entry.pw_copied") : t("entry.copy_password")}
                style={{
                  background:            "var(--c-surface-3)",
                  color:                 pwCopied ? "var(--c-success)" : "var(--c-text-3)",
                  border:                `1px solid ${touched.password && errors.password ? "var(--c-danger)" : "var(--c-border)"}`,
                  borderLeft:            "none",
                  borderTopRightRadius:  8,
                  borderBottomRightRadius: 8,
                  padding:               "0 10px",
                  display:               "flex",
                  alignItems:            "center",
                  flexShrink:            0,
                  cursor:                "pointer",
                  transition:            "color 0.15s",
                }}
              >
                {pwCopied ? <CheckMiniIcon /> : <CopyMiniIcon />}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowGen((v) => !v)}
              className="px-3 rounded-lg text-xs font-medium shrink-0 transition-colors"
              style={{
                background: showGen ? "var(--c-accent)" : "var(--c-surface-3)",
                color: showGen ? "white" : "var(--c-text-2)",
              }}
            >
              {t("entry.generate")}
            </button>
          </div>

          {showGen && (
            <div className="mt-2">
              <PasswordGenerator
                onUse={(pw) => {
                  set("password", pw);
                  touch("password");
                  setShowGen(false);
                }}
              />
            </div>
          )}
        </Field>

        <Field label={t("entry.field.url")} error={touched.url ? errors.url : null}>
          <input
            type="text"
            value={form.url ?? ""}
            onChange={(e) => set("url", e.target.value)}
            onBlur={() => touch("url")}
            placeholder={t("entry.placeholder.url")}
            className="form-input"
            style={inputStyle(!!touched.url && !!errors.url)}
          />
        </Field>

        <Field label={t("entry.field.notes")}>
          <textarea
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder={t("entry.placeholder.notes")}
            className="form-input resize-none"
            style={{ ...inputStyle(false), lineHeight: 1.5 }}
          />
        </Field>

        {/* Conflict resolution panel */}
        {initial?.conflict && initial?.conflict_data && (
          <ConflictPanel
            entryId={initial.id}
            localEntry={form}
            cloudJson={initial.conflict_data}
            onResolved={onConflictResolved ?? (() => {})}
          />
        )}
      </form>

      {/* Confirm dialogs */}
      {dialog}

      {/* Footer */}
      <div
        className="flex items-center gap-2 px-5 py-3 shrink-0"
        style={{ borderTop: "1px solid var(--c-border)" }}
      >
        {/* Delete — only when editing an existing entry */}
        {initial && onDelete && (
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: t("entry.delete.dialog_title", { title: initial.title }),
                message: t("entry.delete.message"),
                confirmLabel: t("entry.delete"),
                variant: "danger",
              });
              if (ok) onDelete();
            }}
            className="p-2 rounded-lg transition-colors"
            title={t("entry.delete.label")}
            style={{ color: "var(--c-danger)", background: "rgba(248,113,113,0.08)" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.18)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "rgba(248,113,113,0.08)")
            }
          >
            <TrashIcon />
          </button>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 rounded-lg text-sm transition-colors"
          style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
        >
          {t("entry.cancel")}
        </button>
        <button
          type="submit"
          form="entry-form"
          disabled={!isValid}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: isValid ? "var(--c-accent)" : "var(--c-surface-3)",
            color: isValid ? "white" : "var(--c-text-3)",
            cursor: isValid ? "pointer" : "default",
          }}
        >
          <SaveIcon />
          {t("entry.save")}
        </button>
      </div>
    </div>
  );
}

/* ── Conflict panel ──────────────────────────────────────────────────────── */

function ConflictPanel({
  entryId,
  localEntry,
  cloudJson,
  onResolved,
}: {
  entryId: number;
  localEntry: NewEntry;
  cloudJson: string;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const [resolving, setResolving]     = useState(false);
  const [showLocalPw, setShowLocalPw] = useState(false);
  const [showCloudPw, setShowCloudPw] = useState(false);

  let cloud: Partial<NewEntry>;
  try {
    cloud = JSON.parse(cloudJson);
  } catch {
    return null;
  }

  const diffFields = CONFLICT_FIELDS.filter(
    ({ key }) => (localEntry[key] ?? "") !== (cloud[key] ?? "")
  );

  if (diffFields.length === 0) return null;

  async function resolve(useCloud: boolean) {
    setResolving(true);
    try {
      await invoke("resolve_conflict", { id: entryId, useCloud });
      onResolved();
    } catch (e) {
      console.error("resolve_conflict failed:", e);
      setResolving(false);
    }
  }

  return (
    <div
      className="rounded-xl space-y-3 p-4"
      style={{
        background: "rgba(251,191,36,0.06)",
        border: "1px solid rgba(251,191,36,0.3)",
      }}
    >
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 14, lineHeight: 1 }}>⚠</span>
        <p className="text-xs font-semibold" style={{ color: "var(--c-warn)" }}>
          {t("entry.conflict.title")}
        </p>
      </div>
      <p className="text-xs" style={{ color: "var(--c-text-2)" }}>
        {t("entry.conflict.message")}
      </p>

      <div className="space-y-2">
        {diffFields.map(({ key, i18nKey }) => {
          const local  = String(localEntry[key] ?? "—");
          const remote = String(cloud[key]      ?? "—");
          const masked = key === "password";
          return (
            <div
              key={key}
              className="rounded-lg p-2 space-y-1"
              style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
            >
              <p className="text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
                {t(i18nKey)}
              </p>
              <div className="flex gap-2 text-xs">
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <p style={{ color: "var(--c-text-3)" }}>{t("entry.conflict.local")}</p>
                    {masked && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowLocalPw((v) => !v)}
                        style={{ color: "var(--c-text-3)" }}
                      >
                        {showLocalPw ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    )}
                  </div>
                  <p
                    className="font-mono"
                    style={{ color: "var(--c-text-1)", wordBreak: "break-all" }}
                  >
                    {masked && !showLocalPw ? "•".repeat(Math.min(local.length, 12)) : local}
                  </p>
                </div>
                <div style={{ width: 1, background: "var(--c-border)", flexShrink: 0 }} />
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <p style={{ color: "var(--c-text-3)" }}>{t("entry.conflict.cloud")}</p>
                    {masked && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowCloudPw((v) => !v)}
                        style={{ color: "var(--c-text-3)" }}
                      >
                        {showCloudPw ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    )}
                  </div>
                  <p
                    className="font-mono"
                    style={{ color: "var(--c-text-1)", wordBreak: "break-all" }}
                  >
                    {masked && !showCloudPw ? "•".repeat(Math.min(remote.length, 12)) : remote}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={resolving}
          onClick={() => resolve(false)}
          className="flex-1 py-2 rounded-lg text-xs font-medium"
          style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
        >
          {t("entry.conflict.keep_local")}
        </button>
        <button
          type="button"
          disabled={resolving}
          onClick={() => resolve(true)}
          className="flex-1 py-2 rounded-lg text-xs font-medium"
          style={{ background: "rgba(251,191,36,0.18)", color: "var(--c-warn)" }}
        >
          {t("entry.conflict.keep_cloud")}
        </button>
      </div>
    </div>
  );
}

/* ── Field wrapper ───────────────────────────────────────────────────────── */

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--c-text-2)" }}>
        {label}
        {required && <span style={{ color: "var(--c-danger)" }}>*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs" style={{ color: "var(--c-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Input style helper ──────────────────────────────────────────────────── */

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    background: "var(--c-surface-2)",
    color: "var(--c-text-1)",
    border: `1px solid ${hasError ? "var(--c-danger)" : "var(--c-border)"}`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    width: "100%",
    outline: "none",
    transition: "border-color 0.15s",
  };
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function SaveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}
function CopyMiniIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckMiniIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
