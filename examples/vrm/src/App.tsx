import { useEffect, useRef, useState } from "react";
import {
  LaylaAbortError,
  LaylaSDK,
  type ChatContextNewMessageListener,
} from "../../../src";
import {
  ViewerEngine,
  type CameraTransform,
  type EntityTransform,
  type ViewerSettings,
} from "./viewer/ViewerEngine";
import {
  getStrongestLaylaSentiment,
  mapLaylaSentimentsToVrmExpressions,
  type LaylaSentiment,
  type VrmEmotionExpressionWeights,
} from "./viewer/LaylaSentimentExpressions";
import "./App.css";

type TransformValue = Required<EntityTransform>;
type VectorKey = "position" | "rotation";

const layla = new LaylaSDK();

const normalizeTransform = (transform?: EntityTransform): TransformValue => ({
  position: [...(transform?.position ?? [0, 0, 0])],
  rotation: [...(transform?.rotation ?? [0, 0, 0])],
  scale: transform?.scale ?? 1,
});

const normalizeCamera = (settings: ViewerSettings): CameraTransform => ({
  position: [...(settings.camera?.position ?? [0, 1.25, 2.6])],
  target: [...(settings.camera?.target ?? [0, 1.1, 0])],
  fov: settings.camera?.fov ?? 30,
  zoom: settings.zoom && settings.zoom > 0 ? settings.zoom : 1,
});

function CameraControls({
  value,
  onChange,
}: {
  value: CameraTransform;
  onChange: (value: CameraTransform) => void;
}) {
  const updateVector = (
    key: "position" | "target",
    axis: number,
    next: number,
  ) => {
    const vector = [...value[key]] as [number, number, number];
    vector[axis] = next;
    onChange({ ...value, [key]: vector });
  };

  return (
    <fieldset className="debug-group">
      <legend>Camera</legend>

      {(["position", "target"] as const).map((key) => (
        <div className="debug-control" key={key}>
          <span className="debug-control__name">{key}</span>
          {(["x", "y", "z"] as const).map((axis, index) => (
            <label className="debug-slider" key={axis}>
              <span>{axis}</span>
              <input
                type="range"
                aria-label={`Camera ${key} ${axis}`}
                min={-10}
                max={10}
                step={0.01}
                value={value[key][index]}
                onChange={(event) =>
                  updateVector(key, index, Number(event.target.value))
                }
              />
              <output>{value[key][index].toFixed(2)}</output>
            </label>
          ))}
        </div>
      ))}

      {([
        ["fov", "FOV", 10, 100, 1],
        ["zoom", "Zoom", 0.1, 5, 0.01],
      ] as const).map(([key, label, min, max, step]) => (
        <div className="debug-control" key={key}>
          <span className="debug-control__name">{label}</span>
          <label className="debug-slider">
            <span>{key === "fov" ? "°" : "×"}</span>
            <input
              type="range"
              aria-label={`Camera ${label}`}
              min={min}
              max={max}
              step={step}
              value={value[key]}
              onChange={(event) =>
                onChange({ ...value, [key]: Number(event.target.value) })
              }
            />
            <output>{value[key].toFixed(key === "fov" ? 0 : 2)}</output>
          </label>
        </div>
      ))}
    </fieldset>
  );
}

function TransformControls({
  title,
  value,
  positionRange,
  scaleRange,
  onChange,
}: {
  title: string;
  value: TransformValue;
  positionRange: [number, number, number];
  scaleRange: [number, number, number];
  onChange: (value: TransformValue) => void;
}) {
  const updateVector = (key: VectorKey, axis: number, next: number) => {
    const vector = [...value[key]] as [number, number, number];
    vector[axis] = next;
    onChange({ ...value, [key]: vector });
  };

  return (
    <fieldset className="debug-group">
      <legend>{title}</legend>

      {(["position", "rotation"] as const).map((key) => {
        const range = key === "position" ? positionRange : [-180, 180, 1];
        return (
          <div className="debug-control" key={key}>
            <span className="debug-control__name">{key}</span>
            {(["x", "y", "z"] as const).map((axis, index) => (
              <label className="debug-slider" key={axis}>
                <span>{axis}</span>
                <input
                  type="range"
                  aria-label={`${title} ${key} ${axis}`}
                  min={range[0]}
                  max={range[1]}
                  step={range[2]}
                  value={value[key][index]}
                  onChange={(event) =>
                    updateVector(key, index, Number(event.target.value))
                  }
                />
                <output>{value[key][index].toFixed(key === "rotation" ? 0 : 2)}</output>
              </label>
            ))}
          </div>
        );
      })}

      <div className="debug-control">
        <span className="debug-control__name">scale</span>
        <label className="debug-slider">
          <span>s</span>
          <input
            type="range"
            aria-label={`${title} scale`}
            min={scaleRange[0]}
            max={scaleRange[1]}
            step={scaleRange[2]}
            value={value.scale}
            onChange={(event) =>
              onChange({ ...value, scale: Number(event.target.value) })
            }
          />
          <output>{value.scale.toFixed(2)}</output>
        </label>
      </div>
    </fieldset>
  );
}

function DebugPanel({
  engine,
  settings,
}: {
  engine: ViewerEngine;
  settings: ViewerSettings;
}) {
  const [model, setModel] = useState(() => normalizeTransform(settings.transform));
  const [background, setBackground] = useState(() =>
    normalizeTransform(settings.backgroundTransform),
  );
  const [camera, setCamera] = useState(() => normalizeCamera(settings));

  const updateModel = (value: TransformValue) => {
    setModel(value);
    engine.setModelTransform(value);
  };

  const updateBackground = (value: TransformValue) => {
    setBackground(value);
    engine.setBackgroundTransform(value);
  };

  const updateCamera = (value: CameraTransform) => {
    setCamera(value);
    engine.setCameraTransform(value);
  };

  return (
    <details className="debug-panel" open>
      <summary>Transform debug</summary>
      <div className="debug-panel__content">
        <CameraControls value={camera} onChange={updateCamera} />
        <TransformControls
          title="Model"
          value={model}
          positionRange={[-10, 10, 0.01]}
          scaleRange={[0.01, 10, 0.01]}
          onChange={updateModel}
        />
        <TransformControls
          title="Background"
          value={background}
          positionRange={[-100, 100, 0.1]}
          scaleRange={[0.01, 100, 0.01]}
          onChange={updateBackground}
        />
      </div>
    </details>
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<ViewerSettings | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    let engine: ViewerEngine | null = null;
    let cancelled = false;
    let sentimentRequest: AbortController | null = null;
    let pendingExpressionWeights: VrmEmotionExpressionWeights | null = null;
    let pendingAnimationSentiment: LaylaSentiment | null = null;

    const onNewMessage: ChatContextNewMessageListener = ({ message }) => {
      const text = message.content?.trim();
      if (!text) return;

      sentimentRequest?.abort();
      const request = new AbortController();
      sentimentRequest = request;

      void layla.classifier
        .getSentiment(text, { signal: request.signal })
        .then((sentiments) => {
          if (cancelled || request.signal.aborted) return;

          const strongest = getStrongestLaylaSentiment(sentiments);
          const weights = mapLaylaSentimentsToVrmExpressions(sentiments);
          pendingExpressionWeights = weights;
          pendingAnimationSentiment = strongest?.sentiment ?? null;
          engine?.setExpressions(weights);
          if (engine && strongest) {
            engine.playRandomFromGroup(strongest.sentiment);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof LaylaAbortError) return;
          console.error("Could not analyze chat message sentiment:", err);
        });
    };

    async function boot() {
      try {
        // settings.json is served from the site root (public/settings.json).
        // cache: no-store so edits show up on refresh without a hard reload.
        const [res, executionContext] = await Promise.all([
          fetch("/settings.json", { cache: "no-store" }),
          layla.contextual.getExecutionContext(),
        ]);
        if (!res.ok) throw new Error(`Could not load settings.json (${res.status})`);
        const settings = (await res.json()) as ViewerSettings;
        setSettings(settings);
        setIsStandalone(executionContext === null);

        if (cancelled || !containerRef.current) return;

        engine = new ViewerEngine(containerRef.current, settings);
        await engine.load();
        if (cancelled) {
          engine.dispose();
          return;
        }

        engine.start();
        engineRef.current = engine;
        if (pendingExpressionWeights) {
          engine.setExpressions(pendingExpressionWeights);
        }
        if (pendingAnimationSentiment) {
          engine.playRandomFromGroup(pendingAnimationSentiment);
        }
        // Exposed for programmatic control, e.g. from the console or your own
        // code: avatar.blink(), avatar.setMouthOpen(0.6), avatar.setViseme("oh"),
        // avatar.setAutoBlink(false), avatar.setExpression("happy", 1).
        window.avatar = engine;
        setStatus("ready");
      } catch (err: unknown) {
        console.error(err);
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }

    layla.contextual.on("chatContextNewMessage", onNewMessage);
    boot();

    return () => {
      cancelled = true;
      sentimentRequest?.abort();
      layla.contextual.off("chatContextNewMessage", onNewMessage);
      if (window.avatar === engine) delete window.avatar;
      if (engineRef.current === engine) engineRef.current = null;
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
            Check the paths in <code>settings.json</code> and make sure your
            files exist.
          </p>
        </div>
      )}

      {status === "ready" && isStandalone && settings && engineRef.current && (
        <DebugPanel engine={engineRef.current} settings={settings} />
      )}
    </div>
  );
}
