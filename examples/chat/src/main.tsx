import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

if (import.meta.env.DEV) {
  import("../../../src/mock").then(({ installLaylaMock }) => {
    installLaylaMock({
      respond: (messages) =>
        `You said: ${messages.at(-1)?.content}. Mock response from Layla.`,
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