import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installLaylaMock, makeMockCharacter } from "../../../src/mock";

const MOCK_SESSION_ID = "mock-vrm-session-1";
const MOCK_MESSAGES = [
  { role: "assistant", content: "I'm so happy to see you! This just made my whole day." },
  { role: "assistant", content: "I'm furious right now. I can't believe they treated you like that." },
  { role: "assistant", content: "Being this close to you is making my heart race. I really want you." },
  { role: "assistant", content: "I feel so sad and lonely tonight. I wish you were here." },
  { role: "assistant", content: "I admire your courage so much. You're genuinely incredible." },
  { role: "assistant", content: "That was hilarious! I can't stop laughing about it." },
  { role: "assistant", content: "I'm scared something might go wrong. Can you stay with me?" },
  { role: "assistant", content: "I'm curious now—tell me everything about what happened." },
  { role: "assistant", content: "I care about you deeply, and I want to make sure you're okay." },
  { role: "assistant", content: "Ugh, that's disgusting. I don't even want to think about it." },
] as const;

const root = document.getElementById("root");

if (!root) {
  throw new Error("Could not find the root element.");
}

if (import.meta.env.DEV) {
  const character = makeMockCharacter("Aria", {
    personality: "expressive, affectionate, and emotionally open",
  });
  const mock = installLaylaMock({
    characters: [character],
    executionContext: {
      character,
      session_id: MOCK_SESSION_ID,
    },
  });

  const messageTimer = window.setInterval(() => {
    const message = MOCK_MESSAGES[Math.floor(Math.random() * MOCK_MESSAGES.length)];

    mock.emitChatContextNewMessage({
      message,
      character_id: character.id,
      session_id: MOCK_SESSION_ID,
      timestamp: Date.now(),
    });
  }, 10_000);

  import.meta.hot?.dispose(() => {
    window.clearInterval(messageTimer);
    mock.uninstall();
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
