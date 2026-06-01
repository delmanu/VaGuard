import { useState } from "react";
import type { Entry, NewEntry } from "../types";
import PasswordGenerator from "./PasswordGenerator";

interface Props {
  initial?: Entry;
  onSave: (entry: NewEntry) => void;
  onCancel: () => void;
}

function isValidUrl(value: string) {
  if (!value) return true; // optional
  try { new URL(value.startsWith("http") ? value : `https://${value}`); return true; }
  catch { return false; }
}

export default function EntryForm({ initial, onSave, onCancel }: Props) {
  const [form, setForm] = useState<NewEntry>({
    title:    initial?.title    ?? "",
    username: initial?.username ?? "",
    password: initial?.password ?? "",
    url:      initial?.url      ?? "",
    notes:    initial?.notes    ?? "",
  });
  const [showPw,  setShowPw]  = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof NewEntry, boolean>>>({});

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
    setTouched((t) => ({ ...t, [field]: true }));
  }

  const errors = {
    title:    !form.title.trim()                           ? "Title is required" : null,
    url:      touched.url && !isValidUrl(form.url ?? "")   ? "Invalid URL"        : null,
    password: !form.password.trim()                        ? "Password is required" : null,
  };
  const isValid = !errors.title && !errors.url && !errors.password;

  function handleCancel() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
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
          {initial ? "Edit entry" : "New entry"}
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
          label="Title"
          required
          error={touched.title ? errors.title : null}
        >
          <input
            autoFocus
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => touch("title")}
            placeholder="e.g. GitHub"
            className="form-input"
            style={inputStyle(!!touched.title && !!errors.title)}
          />
        </Field>

        <Field label="Username / email">
          <input
            type="text"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            placeholder="you@example.com"
            className="form-input"
            style={inputStyle(false)}
          />
        </Field>

        {/* Password */}
        <Field label="Password" required error={touched.password ? errors.password : null}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? "text" : "password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                onBlur={() => touch("password")}
                placeholder="••••••••••••"
                className="form-input w-full pr-9"
                style={inputStyle(!!touched.password && !!errors.password)}
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
            <button
              type="button"
              onClick={() => setShowGen((v) => !v)}
              className="px-3 rounded-lg text-xs font-medium shrink-0 transition-colors"
              style={{
                background: showGen ? "var(--c-accent)" : "var(--c-surface-3)",
                color: showGen ? "white" : "var(--c-text-2)",
              }}
            >
              Generate
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

        <Field label="URL" error={touched.url ? errors.url : null}>
          <input
            type="text"
            value={form.url ?? ""}
            onChange={(e) => set("url", e.target.value)}
            onBlur={() => touch("url")}
            placeholder="https://example.com"
            className="form-input"
            style={inputStyle(!!touched.url && !!errors.url)}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Optional notes…"
            className="form-input resize-none"
            style={{ ...inputStyle(false), lineHeight: 1.5 }}
          />
        </Field>
      </form>

      {/* Footer */}
      <div
        className="flex justify-end gap-2 px-5 py-3 shrink-0"
        style={{ borderTop: "1px solid var(--c-border)" }}
      >
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 rounded-lg text-sm transition-colors"
          style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          form="entry-form"
          disabled={!isValid}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: isValid ? "var(--c-accent)" : "var(--c-surface-3)",
            color: isValid ? "white" : "var(--c-text-3)",
            cursor: isValid ? "pointer" : "default",
          }}
        >
          Save
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
