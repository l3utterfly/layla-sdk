import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// In dev (`npm run dev`) there is no native host, so install the browser mock.
// It answers every SDK endpoint, so the diagnostics suite can run end-to-end in
// a plain browser. When this build is copied to the host and loaded in the Layla
// WebView, `import.meta.env.DEV` is false and the real `window.ReactNativeWebView`
// bridge is used instead — the exact same App, exercising the real host.
if (import.meta.env.DEV) {
  void import("../../../src/mock").then(({ installLaylaMock }) => {
    // A tiny in-memory SQL engine: enough for the DB round-trip check
    // (CREATE / INSERT with params / SELECT / DELETE). Unknown tables return an
    // empty result rather than throwing, so the "error isolation" probe against
    // a missing table is reported as inconclusive in the browser (the mock does
    // not raise on_error) — which is the honest answer for an id-less host.
    const tables = new Map<string, Record<string, unknown>[]>();
    const tableName = (sql: string, re: RegExp) =>
      sql.match(re)?.[1]?.toLowerCase() ?? "";

    const handle = installLaylaMock({
      // Echo the prompt so concurrency checks can prove no cross-talk between
      // two simultaneous same-lane generations.
      respond: (messages) => {
        const last = messages.at(-1);
        return `Reply to: "${last?.content ?? "(nothing)"}"`;
      },
      executeSql: (query, params) => {
        const raw = query.trim();
        const sql = raw.toUpperCase();
        if (sql.startsWith("CREATE TABLE")) {
          const name = tableName(raw, /create table (?:if not exists )?["'`]?(\w+)/i);
          if (!tables.has(name)) tables.set(name, []);
          return { rows: [], rowsAffected: 0, insertId: 0 };
        }
        if (sql.startsWith("INSERT")) {
          const name = tableName(raw, /insert into ["'`]?(\w+)/i);
          const rows = tables.get(name) ?? [];
          const insertId =
            rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
          rows.push({ id: insertId, a: params[0] ?? null, b: params[1] ?? null });
          tables.set(name, rows);
          return { rows: [], rowsAffected: 1, insertId };
        }
        if (sql.startsWith("SELECT")) {
          const name = tableName(raw, /from ["'`]?(\w+)/i);
          return { rows: tables.get(name) ?? [], rowsAffected: 0, insertId: 0 };
        }
        if (sql.startsWith("DELETE")) {
          const name = tableName(raw, /from ["'`]?(\w+)/i);
          const n = tables.get(name)?.length ?? 0;
          tables.set(name, []);
          return { rows: [], rowsAffected: n, insertId: 0 };
        }
        return { rows: [], rowsAffected: 0, insertId: 0 };
      },
      // Moderate timings: chat streams several tokens (slow lane) while one-shot
      // reads answer after a single latency (fast lane), so the cross-lane
      // non-blocking check has a clear signal.
      latencyMs: 60,
      tokenDelayMs: 18,
    });

    (window as unknown as { __laylaDiagMock?: typeof handle }).__laylaDiagMock =
      handle;
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
