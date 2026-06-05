import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { loadGenDefaults } from "./SettingsPanel";

interface Props {
  onUse?: (password: string) => void;
}

function calcEntropy(length: number, upper: boolean, numbers: boolean, symbols: boolean): number {
  let pool = 26; // lowercase always
  if (upper)   pool += 26;
  if (numbers) pool += 10;
  if (symbols) pool += 30;
  return Math.floor(length * Math.log2(pool));
}

function entropyKey(bits: number): "generator.weak" | "generator.fair" | "generator.strong" {
  if (bits < 40) return "generator.weak";
  if (bits < 70) return "generator.fair";
  return "generator.strong";
}

function entropyColor(bits: number): string {
  if (bits < 40) return "var(--c-danger)";
  if (bits < 70) return "var(--c-warn)";
  return "var(--c-success)";
}

function entropyPct(bits: number): number {
  if (bits < 40) return Math.max(5, (bits / 128) * 100);
  if (bits < 70) return (bits / 128) * 100;
  return Math.min(100, (bits / 128) * 100);
}

export default function PasswordGenerator({ onUse }: Props) {
  const { t } = useTranslation();
  const defaults = loadGenDefaults();
  const [length,  setLength]  = useState(defaults.length);
  const [upper,   setUpper]   = useState(defaults.upper);
  const [numbers, setNumbers] = useState(defaults.numbers);
  const [symbols, setSymbols] = useState(defaults.symbols);
  const [password, setPassword] = useState("");
  const [copied,   setCopied]   = useState(false);

  const entropy = calcEntropy(length, upper, numbers, symbols);
  const color   = entropyColor(entropy);
  const pct     = entropyPct(entropy);

  const options: [string, boolean, (v: boolean) => void][] = [
    [t("generator.uppercase"), upper,   setUpper],
    [t("generator.numbers"),   numbers, setNumbers],
    [t("generator.symbols"),   symbols, setSymbols],
  ];

  // Auto-generate when options change (after first mount)
  useEffect(() => {
    if (password) generate();
  }, [length, upper, numbers, symbols]);

  async function generate() {
    try {
      const pw = await invoke<string>("generate_password", { length, symbols, numbers });
      setPassword(upper ? pw : pw.toLowerCase());
      setCopied(false);
    } catch (e) {
      console.error(e);
    }
  }

  async function copy() {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
    >
      <p className="text-xs font-semibold" style={{ color: "var(--c-text-2)" }}>
        {t("generator.title")}
      </p>

      {/* Length slider */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs" style={{ color: "var(--c-text-2)" }}>
          <span>{t("generator.length")}</span>
          <span className="font-mono font-semibold" style={{ color: "var(--c-text-1)" }}>
            {length}
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: "var(--c-accent)" }}
        />
        <div className="flex justify-between text-xs" style={{ color: "var(--c-text-3)" }}>
          <span>8</span><span>64</span>
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map(([label, val, setter]) => (
          <label key={label} className="flex items-center gap-1.5 cursor-pointer select-none text-xs" style={{ color: "var(--c-text-2)" }}>
            <input
              type="checkbox"
              checked={val}
              onChange={(e) => setter(e.target.checked)}
              style={{ accentColor: "var(--c-accent)" }}
            />
            {label}
          </label>
        ))}
      </div>

      {/* Entropy bar */}
      <div className="space-y-1">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--c-surface-3)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <p className="text-xs" style={{ color }}>
          {t(entropyKey(entropy), { bits: entropy })}
        </p>
      </div>

      {/* Output */}
      <div className="flex gap-2">
        <input
          readOnly
          value={password}
          placeholder={t("generator.placeholder")}
          className="flex-1 font-mono text-xs rounded-lg px-3 py-2 outline-none min-w-0"
          style={{
            background: "var(--c-surface-3)",
            color: "var(--c-text-1)",
            border: "1px solid var(--c-border)",
          }}
        />
        <button
          onClick={copy}
          disabled={!password}
          className="shrink-0 px-3 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: copied ? "rgba(74,222,128,0.15)" : "var(--c-surface-3)",
            color: copied ? "var(--c-success)" : "var(--c-text-2)",
          }}
        >
          {copied ? t("generator.copied") : t("generator.copy")}
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={generate}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
          style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
        >
          {t("generator.regenerate")}
        </button>
        {onUse && (
          <button
            onClick={() => password && onUse(password)}
            disabled={!password}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: password ? "var(--c-accent)" : "var(--c-surface-3)",
              color: password ? "white" : "var(--c-text-3)",
            }}
          >
            {t("generator.use")}
          </button>
        )}
      </div>
    </div>
  );
}
