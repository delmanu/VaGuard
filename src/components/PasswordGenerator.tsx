import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

function entropyMeta(bits: number): { label: string; color: string; pct: number } {
  if (bits < 40)  return { label: `${bits} bits — Weak`,   color: "var(--c-danger)", pct: Math.max(5, (bits / 128) * 100) };
  if (bits < 70)  return { label: `${bits} bits — Fair`,   color: "var(--c-warn)",   pct: (bits / 128) * 100 };
  return              { label: `${bits} bits — Strong`, color: "var(--c-success)", pct: Math.min(100, (bits / 128) * 100) };
}

export default function PasswordGenerator({ onUse }: Props) {
  const defaults = loadGenDefaults();
  const [length,  setLength]  = useState(defaults.length);
  const [upper,   setUpper]   = useState(defaults.upper);
  const [numbers, setNumbers] = useState(defaults.numbers);
  const [symbols, setSymbols] = useState(defaults.symbols);
  const [password, setPassword] = useState("");
  const [copied,   setCopied]   = useState(false);

  const entropy = calcEntropy(length, upper, numbers, symbols);
  const meta    = entropyMeta(entropy);

  // Auto-generate when options change (after first mount)
  useEffect(() => {
    if (password) generate();
  }, [length, upper, numbers, symbols]);

  async function generate() {
    try {
      const pw = await invoke<string>("generate_password", { length, symbols, numbers });
      // If uppercase not wanted, the Rust side already excludes it;
      // uppercase is part of the base charset (a-z + A-Z) — filter here if needed.
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
        Password generator
      </p>

      {/* Length slider */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs" style={{ color: "var(--c-text-2)" }}>
          <span>Length</span>
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
        {(
          [
            ["Uppercase", upper,   setUpper],
            ["Numbers",  numbers, setNumbers],
            ["Symbols",  symbols, setSymbols],
          ] as [string, boolean, (v: boolean) => void][]
        ).map(([label, val, setter]) => (
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
            style={{ width: `${meta.pct}%`, background: meta.color }}
          />
        </div>
        <p className="text-xs" style={{ color: meta.color }}>{meta.label}</p>
      </div>

      {/* Output */}
      <div className="flex gap-2">
        <input
          readOnly
          value={password}
          placeholder="Click generate…"
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
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={generate}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
          style={{ background: "var(--c-surface-3)", color: "var(--c-text-2)" }}
        >
          ↻ Regenerate
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
            Use this
          </button>
        )}
      </div>
    </div>
  );
}
