import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { GameConfig } from "./types";
import { CharacterSelectModal } from "./components/CharacterSelectModal";
import { GameScreen } from "./components/GameScreen";

export default function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);

  return (
    <AnimatePresence mode="wait">
      {config ? (
        <GameScreen key="game" config={config} onExit={() => setConfig(null)} />
      ) : (
        <CharacterSelectModal key="select" onStart={setConfig} />
      )}
    </AnimatePresence>
  );
}
