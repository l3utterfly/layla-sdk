import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

if (import.meta.env.DEV) {
  import("../../../src/mock").then(({ installLaylaMock }) => {
    installLaylaMock({
      respond: (messages) => {
        const message = messages.at(-1);
        const imageNote = message?.image_base64
          ? " I received the attached image."
          : "";
        return `You said: ${message?.content ?? "(no text)"}.${imageNote} Mock response from Layla.`;
      },
      latencyMs: 300,
      tokenDelayMs: 25,
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
