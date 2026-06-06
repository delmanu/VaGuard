import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Titlebar from "./components/Titlebar";
import UnlockScreen from "./components/UnlockScreen";
import VaultList from "./components/VaultList";
import SettingsPanel, { applyTheme, LOCK_KEY, THEME_KEY, type Theme } from "./components/SettingsPanel";

export default function App() {
  const [unlocked, setUnlocked]               = useState(false);
  const [settingsOpen, setSettingsOpen]       = useState(false);
  const [lockSecondsLeft, setLockSecondsLeft] = useState<number | null>(null);
  const [lockTimeout, setLockTimeout]         = useState(() => parseInt(localStorage.getItem(LOCK_KEY) || "0"));
  const lastActivityRef                       = useRef(Date.now());

  // Apply saved theme on first mount
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    applyTheme(saved ?? "system");
  }, []);

  // Suppress the WebView default context menu
  useEffect(() => {
    const suppress = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  // Auto-lock on inactivity + live countdown
  useEffect(() => {
    if (!unlocked) {
      setLockSecondsLeft(null);
      return;
    }

    if (lockTimeout === 0) {
      setLockSecondsLeft(null);
      return;
    }

    lastActivityRef.current = Date.now();
    const ms = lockTimeout * 60 * 1000;

    function resetTimer() { lastActivityRef.current = Date.now(); }
    document.addEventListener("mousemove", resetTimer);
    document.addEventListener("keydown",   resetTimer);

    const interval = setInterval(() => {
      const elapsed    = Date.now() - lastActivityRef.current;
      const remaining  = ms - elapsed;
      if (remaining <= 0) {
        setLockSecondsLeft(null);
        invoke("lock_vault").then(() => setUnlocked(false));
      } else {
        setLockSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1_000);

    return () => {
      document.removeEventListener("mousemove", resetTimer);
      document.removeEventListener("keydown",   resetTimer);
      clearInterval(interval);
      setLockSecondsLeft(null);
    };
  }, [unlocked, lockTimeout]);

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--c-bg)", overflow: "hidden" }}
    >
      <Titlebar
        unlocked={unlocked}
        lockSecondsLeft={lockSecondsLeft}
        onLock={() => setUnlocked(false)}
        onSettings={() => setSettingsOpen((v) => !v)}
      />

      <main className="flex-1 overflow-hidden relative">
        {unlocked ? (
          <VaultList onLock={() => setUnlocked(false)} />
        ) : (
          <UnlockScreen onUnlocked={() => setUnlocked(true)} />
        )}

        {settingsOpen && (
          <SettingsPanel
            unlocked={unlocked}
            onClose={() => setSettingsOpen(false)}
            onLockTimeoutChange={setLockTimeout}
          />
        )}
      </main>
    </div>
  );
}
