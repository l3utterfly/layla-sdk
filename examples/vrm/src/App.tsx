import { useEffect, useRef, useState } from "react";
import {
  LaylaSDK,
  type ChatContextFinishedSpeakingListener,
  type ChatContextSentimentUpdateListener,
  type ChatContextStartedSpeakingListener,
} from "../../../src";
import {
  ViewerEngine,
  type BackgroundAssetType,
  type CameraTransform,
  type EntityTransform,
  type ViewerSettings,
} from "./viewer/ViewerEngine";
import {
  mapLaylaSentimentToVrmExpressions,
  type LaylaSentiment,
  type VrmEmotionExpressionWeights,
} from "./viewer/LaylaSentimentExpressions";
import {
  buildVrmExportArchive,
  captureViewerArtwork,
  downloadArchive,
  type ExportAsset,
} from "./exportArchive";
import "./App.css";

type TransformValue = Required<EntityTransform>;
type VectorKey = "position" | "rotation";

const layla = new LaylaSDK();

const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const isImageFile = (file: File) =>
  file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name);
const getAssetName = (value?: string | null) =>
  value?.split(/[\\/]/).pop()?.split(/[?#]/)[0] || "None";
const getConfiguredAsset = (value?: string | null): ExportAsset | null =>
  value ? { name: getAssetName(value), source: value } : null;
const getBackgroundAssetType = (
  value?: string | null,
): BackgroundAssetType | null => {
  if (!value) return null;
  if (/\.glb(?:[?#].*)?$/i.test(value)) return "glb";
  if (/\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(value)) {
    return "image";
  }
  return null;
};

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

function DebugNumberInput({
  label,
  value,
  min,
  max,
  step,
  precision,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => value.toFixed(precision));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value.toFixed(precision));
  }, [editing, precision, value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(precision));
      return;
    }

    const next = Math.min(max, Math.max(min, parsed));
    onChange(next);
    setDraft(next.toFixed(precision));
  };

  return (
    <input
      className="debug-slider__number"
      type="number"
      aria-label={`${label} value`}
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) {
          onChange(next);
        }
      }}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

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
            <div className="debug-slider" key={axis}>
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
              <DebugNumberInput
                label={`Camera ${key} ${axis}`}
                min={-10}
                max={10}
                step={0.01}
                precision={2}
                value={value[key][index]}
                onChange={(next) => updateVector(key, index, next)}
              />
            </div>
          ))}
        </div>
      ))}

      {([
        ["fov", "FOV", 10, 100, 1],
        ["zoom", "Zoom", 0.1, 5, 0.01],
      ] as const).map(([key, label, min, max, step]) => (
        <div className="debug-control" key={key}>
          <span className="debug-control__name">{label}</span>
          <div className="debug-slider">
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
            <DebugNumberInput
              label={`Camera ${label}`}
              min={min}
              max={max}
              step={step}
              precision={key === "fov" ? 0 : 2}
              value={value[key]}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
          </div>
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
              <div className="debug-slider" key={axis}>
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
                <DebugNumberInput
                  label={`${title} ${key} ${axis}`}
                  min={range[0]}
                  max={range[1]}
                  step={range[2]}
                  precision={key === "rotation" ? 0 : 2}
                  value={value[key][index]}
                  onChange={(next) => updateVector(key, index, next)}
                />
              </div>
            ))}
          </div>
        );
      })}

      <div className="debug-control">
        <span className="debug-control__name">scale</span>
        <div className="debug-slider">
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
          <DebugNumberInput
            label={`${title} scale`}
            min={scaleRange[0]}
            max={scaleRange[1]}
            step={scaleRange[2]}
            precision={2}
            value={value.scale}
            onChange={(next) => onChange({ ...value, scale: next })}
          />
        </div>
      </div>
    </fieldset>
  );
}

function DebugFilePicker({
  title,
  prompt,
  accept,
  name,
  loading,
  disabled,
  error,
  onChange,
  onRemove,
}: {
  title: string;
  prompt: string;
  accept: string;
  name: string;
  loading: boolean;
  disabled: boolean;
  error: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  onRemove?: () => void;
}) {
  return (
    <fieldset className="debug-group">
      <legend>{title}</legend>
      <label
        className={`debug-file-picker${
          disabled ? " debug-file-picker--disabled" : ""
        }${loading ? " debug-file-picker--loading" : ""}`}
      >
        <span>{loading ? "Loading…" : prompt}</span>
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={onChange}
        />
      </label>
      <div className="debug-file-row">
        <span className="debug-file-name" title={name}>
          {name}
        </span>
        {onRemove && (
          <button
            className="debug-file-remove"
            type="button"
            disabled={disabled || name === "None"}
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="debug-file-error" role="alert">
          {error}
        </p>
      )}
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
  const [modelAsset, setModelAsset] = useState<ExportAsset>(() => ({
    name: getAssetName(settings.model),
    source: settings.model,
  }));
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [skyboxAsset, setSkyboxAsset] = useState<ExportAsset | null>(() =>
    getConfiguredAsset(settings.skybox),
  );
  const [skyboxLoading, setSkyboxLoading] = useState(false);
  const [skyboxError, setSkyboxError] = useState("");
  const [backgroundType, setBackgroundType] =
    useState<BackgroundAssetType | null>(() =>
      getBackgroundAssetType(settings.background),
    );
  const [backgroundAsset, setBackgroundAsset] =
    useState<ExportAsset | null>(() =>
      getBackgroundAssetType(settings.background)
        ? getConfiguredAsset(settings.background)
        : null,
    );
  const [backgroundValue, setBackgroundValue] = useState<string | null>(() =>
    getBackgroundAssetType(settings.background)
      ? null
      : (settings.background ?? null),
  );
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const assetLoading = modelLoading || skyboxLoading || backgroundLoading;

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

  const selectModel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const modelUrl = URL.createObjectURL(file);
    setModelLoading(true);
    setModelError("");

    try {
      await engine.loadModel(modelUrl, model);
      setModelAsset({ name: file.name, source: file });
    } catch (err: unknown) {
      console.error("Could not load the selected VRM model:", err);
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      URL.revokeObjectURL(modelUrl);
      setModelLoading(false);
    }
  };

  const selectSkybox = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!isImageFile(file)) {
      setSkyboxError("Choose an image file for the skybox.");
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    setSkyboxLoading(true);
    setSkyboxError("");

    try {
      await engine.loadSkybox(imageUrl);
      setSkyboxAsset({ name: file.name, source: file });
      if (backgroundType === "image") {
        setBackgroundAsset(null);
        setBackgroundValue(null);
        setBackgroundType(null);
      }
    } catch (err: unknown) {
      console.error("Could not load the selected skybox:", err);
      setSkyboxError(err instanceof Error ? err.message : String(err));
    } finally {
      URL.revokeObjectURL(imageUrl);
      setSkyboxLoading(false);
    }
  };

  const selectBackground = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const type: BackgroundAssetType | null = /\.glb$/i.test(file.name)
      ? "glb"
      : isImageFile(file)
        ? "image"
        : null;
    if (!type) {
      setBackgroundError("Choose an image or .glb file for the background.");
      return;
    }

    const assetUrl = URL.createObjectURL(file);
    setBackgroundLoading(true);
    setBackgroundError("");

    try {
      await engine.loadBackground(assetUrl, type, background);
      setBackgroundAsset({ name: file.name, source: file });
      setBackgroundValue(null);
      setBackgroundType(type);
      if (type === "image") setSkyboxAsset(null);
    } catch (err: unknown) {
      console.error("Could not load the selected background:", err);
      setBackgroundError(err instanceof Error ? err.message : String(err));
    } finally {
      URL.revokeObjectURL(assetUrl);
      setBackgroundLoading(false);
    }
  };

  const removeSkybox = () => {
    engine.removeSkybox();
    setSkyboxAsset(null);
    setSkyboxError("");
  };

  const removeBackground = () => {
    engine.removeBackground();
    setBackgroundAsset(null);
    setBackgroundValue(null);
    setBackgroundType(null);
    setBackgroundError("");
  };

  const exportArchive = async () => {
    setExporting(true);
    setExportError("");

    try {
      const artwork = await captureViewerArtwork(engine.captureFrame());
      const archive = await buildVrmExportArchive({
        settings,
        model: modelAsset,
        background: backgroundAsset,
        backgroundValue,
        skybox: skyboxAsset,
        modelTransform: model,
        backgroundTransform: background,
        camera,
        artwork,
      });
      downloadArchive(archive, modelAsset.name);
    } catch (err: unknown) {
      console.error("Could not export the VRM package:", err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <details className="debug-panel" open>
      <summary>Transform debug</summary>
      <div className="debug-panel__content">
        <DebugFilePicker
          title="VRM model"
          prompt="Choose .vrm file"
          accept=".vrm,model/gltf-binary"
          name={modelAsset.name}
          loading={modelLoading}
          disabled={assetLoading || exporting}
          error={modelError}
          onChange={selectModel}
        />
        <DebugFilePicker
          title="Skybox"
          prompt="Choose image"
          accept="image/*"
          name={skyboxAsset?.name ?? "None"}
          loading={skyboxLoading}
          disabled={assetLoading || exporting}
          error={skyboxError}
          onChange={selectSkybox}
          onRemove={removeSkybox}
        />
        <DebugFilePicker
          title="Background"
          prompt="Choose image or .glb file"
          accept="image/*,.glb,model/gltf-binary"
          name={backgroundAsset?.name ?? backgroundValue ?? "None"}
          loading={backgroundLoading}
          disabled={assetLoading || exporting}
          error={backgroundError}
          onChange={selectBackground}
          onRemove={removeBackground}
        />
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
        <div className="debug-export">
          <button
            className="debug-export__button"
            type="button"
            disabled={assetLoading || exporting}
            onClick={() => void exportArchive()}
          >
            {exporting ? "Creating zip…" : "Export zip"}
          </button>
          {exportError && (
            <p className="debug-file-error" role="alert">
              {exportError}
            </p>
          )}
        </div>
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
    let pendingExpressionWeights: VrmEmotionExpressionWeights | null = null;
    let pendingAnimationSentiment: LaylaSentiment | null = null;
    let isSpeaking = false;

    const onStartedSpeaking: ChatContextStartedSpeakingListener = () => {
      if (cancelled) return;
      isSpeaking = true;
      engine?.startTalking();
    };

    const onFinishedSpeaking: ChatContextFinishedSpeakingListener = () => {
      if (cancelled) return;
      isSpeaking = false;
      engine?.stopTalking();
    };

    const onSentimentUpdate: ChatContextSentimentUpdateListener = ({
      sentiment,
    }) => {
      if (cancelled) return;

      const weights = mapLaylaSentimentToVrmExpressions(sentiment);
      pendingExpressionWeights = weights;
      pendingAnimationSentiment = sentiment;
      engine?.setExpressions(weights);
      engine?.playRandomFromGroup(sentiment);
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
        if (isSpeaking) engine.startTalking();
        engineRef.current = engine;
        if (pendingExpressionWeights) {
          engine.setExpressions(pendingExpressionWeights);
        }
        if (pendingAnimationSentiment) {
          engine.playRandomFromGroup(pendingAnimationSentiment);
        }
        // Exposed for programmatic control, e.g. from the console or your own
        // code: avatar.blink(), avatar.startTalking(), avatar.stopTalking(),
        // avatar.setMouthOpen(0.6), avatar.setExpression("happy", 1).
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

    layla.contextual.on("chatContextSentimentUpdate", onSentimentUpdate);
    layla.contextual.on("chatContextStartedSpeaking", onStartedSpeaking);
    layla.contextual.on("chatContextFinishedSpeaking", onFinishedSpeaking);
    boot();

    return () => {
      cancelled = true;
      layla.contextual.off("chatContextSentimentUpdate", onSentimentUpdate);
      layla.contextual.off("chatContextStartedSpeaking", onStartedSpeaking);
      layla.contextual.off("chatContextFinishedSpeaking", onFinishedSpeaking);
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
