import { useState } from "react";
import Titlebar from "./components/Titlebar";
import UnlockScreen from "./components/UnlockScreen";
import VaultList from "./components/VaultList";

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--c-bg)", overflow: "hidden" }}
    >
      <Titlebar unlocked={unlocked} onLock={() => setUnlocked(false)} />

      <main className="flex-1 overflow-hidden">
        {unlocked ? (
          <VaultList />
        ) : (
          <UnlockScreen onUnlocked={() => setUnlocked(true)} />
        )}
      </main>
    </div>
  );
}
