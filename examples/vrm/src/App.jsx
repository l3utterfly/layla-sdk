import { useEffect, useRef, useState } from "react";
import { ViewerEngine } from "./viewer/ViewerEngine.js";
import "./App.css";

export default function App() {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    let engine = null;
    let cancelled = false;

    async function boot() {
      try {
        // settings.json is served from the site root (public/settings.json).
        // cache: no-store so edits show up on refresh without a hard reload.
        const res = await fetch("/settings.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`Could not load settings.json (${res.status})`);
        const settings = await res.json();

        if (cancelled) return;

        engine = new ViewerEngine(containerRef.current, settings);
        await engine.load();
        if (cancelled) {
          engine.dispose();
          return;
        }

        engine.start();
        // Exposed for programmatic control, e.g. from the console or your own
        // code: avatar.blink(), avatar.setMouthOpen(0.6), avatar.setViseme("oh"),
        // avatar.setAutoBlink(false), avatar.setExpression("happy", 1).
        window.avatar = engine;
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setMessage(err.message ?? String(err));
          setStatus("error");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      if (window.avatar === engine) delete window.avatar;
      engine?.dispose();
    };
  }, []);

  return (
    <div className="stage">
      <div ref={containerRef} className="canvas-host" />

      {status === "loading" && (
        <div className="overlay">
          <div className="spinner" aria-hidden="true" />
          <p>Loading avatar…</p>
        </div>
      )}

      {status === "error" && (
        <div className="overlay overlay--error" role="alert">
          <p className="overlay__title">Couldn't start the viewer</p>
          <p className="overlay__detail">{message}</p>
          <p className="overlay__hint">
            Check the paths in <code>public/settings.json</code> and make sure your
            files exist under <code>public/models/</code>.
          </p>
        </div>
      )}
    </div>
  );
}
