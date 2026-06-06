import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { installLaylaMock, makeMockCharacter } from "@layla-network/sdk";

if (import.meta.env.DEV) {
 installLaylaMock({
      respond: (messages) =>
        `You said: ${messages.at(-1)?.content}. Mock output.`,
      characters: [
        makeMockCharacter("Aria"),
        makeMockCharacter("Kai", { tags: ["demo"] }),
      ],
      latencyMs: 150, // simulated first-token latency
      tokenDelayMs: 40, // simulated inter-token delay
      errorRate: 0, // 0..1 chance a request fails with on_error (test error paths)
      debug: true, // log bridge traffic
    });
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
