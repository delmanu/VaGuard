import { useEffect, useState } from "react";
import Titlebar from "./components/Titlebar";
import UnlockScreen from "./components/UnlockScreen";
import VaultList from "./components/VaultList";

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  // Disable the WebView default context menu across the entire app
  useEffect(() => {
    const suppress = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--c-bg)", overflow: "hidden" }}
    >
      <Titlebar unlocked={unlocked} onLock={() => setUnlocked(false)} />

      <main className="flex-1 overflow-hidden">
        {unlocked ? (
          <VaultList onLock={() => setUnlocked(false)} />
        ) : (
          <UnlockScreen onUnlocked={() => setUnlocked(true)} />
        )}
      </main>
    </div>
  );
}
