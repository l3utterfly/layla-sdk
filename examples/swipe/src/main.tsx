import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CharacterSwipeDeck from "./App.tsx";
import { installLaylaMock } from "../../../src/mock";

if (import.meta.env.DEV) {
  const names = ["Mira", "Theo", "Juno", "Sage", "Nova", "Remy"];
  let n = 0;

  installLaylaMock({
    respond: () => {
      const name = names[n % names.length];
      n += 1;
      return JSON.stringify({
        name,
        age: 27 + (n % 7),
        tagline: "Makes ordinary afternoons feel slightly cinematic",
        description:
          "A warm, fictional city wanderer with a specific sense of style and a habit of finding the best tucked-away tables.",
        tags: ["Curious", "Warm", "Playful"],
        likes: ["ramen", "photography", "quiet nights in"],
        dislikes: ["clubbing"],
        imagePrompt: `${name}, stylish fictional young adult, soft natural light, city cafe window seat, warm smile, contemporary outfit, shallow depth of field`,
      });
    },
    latencyMs: 220,
    tokenDelayMs: 12,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CharacterSwipeDeck />
  </StrictMode>,
);
