import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Titlebar from "./components/Titlebar";
import UnlockScreen from "./components/UnlockScreen";
import VaultList from "./components/VaultList";
import SettingsPanel, { applyTheme, LOCK_KEY, THEME_KEY, type Theme } from "./components/SettingsPanel";

export default function App() {
  const [unlocked, setUnlocked]         = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastActivityRef                 = useRef(Date.now());

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

  // Auto-lock on inactivity
  useEffect(() => {
    if (!unlocked) return;

    const timeout = parseInt(localStorage.getItem(LOCK_KEY) || "0");
    if (timeout === 0) return;

    const ms = timeout * 60 * 1000;

    function resetTimer() { lastActivityRef.current = Date.now(); }
    document.addEventListener("mousemove", resetTimer);
    document.addEventListener("keydown",   resetTimer);

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > ms) {
        invoke("lock_vault").then(() => setUnlocked(false));
      }
    }, 15_000);

    return () => {
      document.removeEventListener("mousemove", resetTimer);
      document.removeEventListener("keydown",   resetTimer);
      clearInterval(interval);
    };
  }, [unlocked]);

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--c-bg)", overflow: "hidden" }}
    >
      <Titlebar
        unlocked={unlocked}
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
          />
        )}
      </main>
    </div>
  );
}
