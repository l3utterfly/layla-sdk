import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LaylaSDK,
  type ChatContextFinishedSpeakingListener,
  type ChatContextSentimentUpdateListener,
  type ChatContextStartedSpeakingListener,
  type ChatContextStartedThinkingListener,
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
  getVrmExportArchiveName,
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

type HelpMedia = {
  type: "image" | "video";
  /** Public path to the asset. */
  src: string;
  caption?: string;
};

type HelpStep = {
  title: string;
  text: string;
  optional?: boolean;
  link?: { href: string; label: string };
  /** One or more screenshots/clips; multiple items lay out in columns. */
  media?: HelpMedia[];
};

const DOWNLOAD_STEPS: HelpStep[] = [
  {
    title: "Download a VRM model",
    text: "Grab an avatar from VRoid Hub. Filter for models that are free to use and downloadable, then open a model and download its .vrm file.",
    link: {
      href: "https://hub.vroid.com/en/models?is_other_users_available=1&is_downloadable=1",
      label: "Open VRoid Hub",
    },
    media: [
      {
        type: "image",
        src: "/tutorial/download/1.jpg",
        caption: "Browse and pick a model",
      },
      {
        type: "video",
        src: "/tutorial/download/1.1.mp4",
        caption: "Download the .vrm file",
      },
    ],
  },
  {
    title: "Add an environment",
    text: "Set the scene with a background. Any .glb model works — Sketchfab's places & travel category is a good place to start.",
    optional: true,
    link: {
      href: "https://sketchfab.com/3d-models/categories/places-travel?date=week&sort_by=-likeCount&cursor=bz04JnA9Mg%3D%3D",
      label: "Browse Sketchfab",
    },
    media: [{ type: "image", src: "/tutorial/download/2.jpg" }],
  },
  {
    title: "Set a skybox image",
    text: "Wrap the scene in atmosphere by loading an image as the skybox. It fills the space behind your model and environment.",
    optional: true,
    media: [{ type: "image", src: "/tutorial/download/3.jpg" }],
  },
  {
    title: "Adjust each transform",
    text: "Fine-tune the scale and rotation for the model and background until the composition looks right on your screen.",
    media: [{ type: "image", src: "/tutorial/download/4.jpg" }],
  },
  {
    title: "Export your scene",
    text: "When it looks right, export a zip package. Your model, background, skybox, and transforms are all bundled together, ready to use.",
    media: [{ type: "image", src: "/tutorial/download/5.jpg" }],
  },
];

const IMPORT_STEPS: HelpStep[] = [
  {
    title: "Add an animated background",
    text: "Open your character in Layla, go to the Appearance tab, and add an Animated Background.",
    media: [{ type: "image", src: "/tutorial/import/1.jpg" }],
  },
  {
    title: 'Choose the type "Mini-app"',
    text: "When Layla asks for a background type, pick Mini-app — that's the format your scene was exported as.",
    media: [{ type: "image", src: "/tutorial/import/2.jpg" }],
  },
  {
    title: "Choose your exported mini-app",
    text: "Select your scene from the list. If it isn't there yet, tap Import Custom Mini-app and pick the .zip you just exported.",
    media: [{ type: "image", src: "/tutorial/import/3.jpg" }],
  },
  {
    title: "Chat with your character!",
    text: "Save, then start chatting — your character now lives inside the scene you built.",
    media: [{ type: "video", src: "/tutorial/import/4.mp4" }],
  },
];

function TutorialModal({
  eyebrow,
  title,
  intro,
  steps,
  onClose,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  steps: HelpStep[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={onClose}
    >
      <div className="help-modal" onClick={(event) => event.stopPropagation()}>
        <header className="help-modal__header">
          <div className="help-modal__heading">
            <p className="help-modal__eyebrow">{eyebrow}</p>
            <h1 className="help-modal__title" id="help-title">
              {title}
            </h1>
          </div>
          <button
            ref={closeRef}
            className="help-modal__close"
            type="button"
            onClick={onClose}
            aria-label="Close help"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="help-modal__body">
          <p className="help-modal__intro">{intro}</p>

          <ol className="help-steps">
            {steps.map((step, index) => (
              <li className="help-step" key={step.title}>
                <div className="help-step__marker" aria-hidden="true">
                  {index + 1}
                </div>
                <div className="help-step__content">
                  <h2 className="help-step__title">
                    {step.title}
                    {step.optional && (
                      <span className="help-step__badge">Optional</span>
                    )}
                  </h2>
                  <p className="help-step__text">{step.text}</p>
                  {step.link && (
                    <a
                      className="help-step__link"
                      href={step.link.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {step.link.label}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M7 17L17 7M9 7h8v8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                  )}
                  {step.media && step.media.length > 0 ? (
                    <div
                      className={`help-shots${
                        step.media.length > 1 ? " help-shots--split" : ""
                      }`}
                    >
                      {step.media.map((item) => (
                        <figure className="help-shot" key={item.src}>
                          {item.type === "video" ? (
                            <video
                              className="help-shot__media"
                              src={item.src}
                              autoPlay
                              loop
                              muted
                              playsInline
                              controls
                            />
                          ) : (
                            <img
                              className="help-shot__media"
                              src={item.src}
                              alt={`${step.title} screenshot`}
                              loading="lazy"
                            />
                          )}
                          {item.caption && (
                            <figcaption className="help-shot__caption">
                              {item.caption}
                            </figcaption>
                          )}
                        </figure>
                      ))}
                    </div>
                  ) : (
                    // Fallback placeholder when a step has no media yet.
                    <figure className="help-shot">
                      <div className="help-shot__placeholder">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect
                            x="3"
                            y="5"
                            width="18"
                            height="14"
                            rx="2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                          <path
                            d="M5 18l4.5-5 3 3.5L15 14l4 4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>Screenshot coming soon</span>
                      </div>
                    </figure>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>,
    document.body,
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
      const filename = getVrmExportArchiveName(modelAsset.name);
      const result = await layla.utils.saveFile(filename, archive, true);
      if (!result.success) {
        throw new Error(result.message ?? `Could not save ${filename}.`);
      }
      setImportOpen(true);
    } catch (err: unknown) {
      console.error("Could not export the VRM package:", err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <details className="debug-panel" open>
        <summary>Transform debug</summary>
        <div className="debug-panel__content">
          <button
            className="debug-help-button"
            type="button"
            onClick={() => setHelpOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M9.2 9.3a2.8 2.8 0 015.4 1c0 1.9-2.6 2.2-2.6 3.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="12" cy="17.4" r="1" fill="currentColor" />
            </svg>
            How to use this viewer
          </button>
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
      {helpOpen && (
        <TutorialModal
          eyebrow="VRM Viewer"
          title="How to build your scene"
          intro="Load an avatar, dress the scene around it, then dial in the framing. Steps two and three are optional — a bare avatar works fine on its own."
          steps={DOWNLOAD_STEPS}
          onClose={() => setHelpOpen(false)}
        />
      )}
      {importOpen && (
        <TutorialModal
          eyebrow="Scene exported"
          title="Import your scene into Layla"
          intro="Your scene saved as a .zip mini-app. Here's how to load it onto a character and chat inside it."
          steps={IMPORT_STEPS}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}

// The minimum Layla app version this mini-app supports. getExecutionContext
// reports the host version as e.g. "7.1.0" or "7.1.0-alpha" (the pre-release
// suffix is optional and ignored for comparison).
const MIN_LAYLA_VERSION = "7.1.0";

// Compare two dotted numeric versions, ignoring any "-suffix". Returns true when
// `version` is strictly older than `minimum`. Unparseable versions are treated
// as supported so a malformed host string never locks the user out.
function isVersionBelow(version: string, minimum: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10));

  const actual = parse(version);
  if (actual.some(Number.isNaN)) return false;
  const required = parse(minimum);

  const length = Math.max(actual.length, required.length);
  for (let i = 0; i < length; i++) {
    const a = actual[i] ?? 0;
    const b = required[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<ViewerSettings | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [versionUnsupported, setVersionUnsupported] = useState(false);

  useEffect(() => {
    let engine: ViewerEngine | null = null;
    let cancelled = false;
    let pendingExpressionWeights: VrmEmotionExpressionWeights | null = null;
    let pendingAnimation:
      | { kind: "sentiment"; sentiment: LaylaSentiment }
      | { kind: "thinking" }
      | null = null;
    let isSpeaking = false;

    // Tap-to-look: a tap points the avatar at the touch location, then it eases
    // back to facing the camera after a short pause. Each tap refreshes the pause,
    // so repeated taps keep it looking around. Mobile-first, so this is driven by
    // pointer events (which cover touch, pen, and mouse alike).
    const LOOK_BACK_DELAY_MS = 1000;
    let lookBackTimer: ReturnType<typeof setTimeout> | undefined;

    const onPointerTap = (event: PointerEvent) => {
      if (!engine) return;
      engine.lookAt(event.clientX, event.clientY);
      if (lookBackTimer !== undefined) clearTimeout(lookBackTimer);
      lookBackTimer = setTimeout(() => engine?.stopLookAt(), LOOK_BACK_DELAY_MS);
    };

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
      pendingAnimation = { kind: "sentiment", sentiment };
      engine?.setExpressions(weights);
      engine?.playRandomFromGroup(sentiment);
    };

    const onStartedThinking: ChatContextStartedThinkingListener = () => {
      if (cancelled) return;
      pendingAnimation = { kind: "thinking" };
      engine?.playRandomThinking();
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
        setVersionUnsupported(
          isVersionBelow(executionContext.app_version, MIN_LAYLA_VERSION),
        );
        setIsStandalone(
          executionContext.character === null &&
            executionContext.session_id === null,
        );

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
        if (pendingAnimation?.kind === "sentiment") {
          engine.playRandomFromGroup(pendingAnimation.sentiment);
        } else if (pendingAnimation?.kind === "thinking") {
          engine.playRandomThinking();
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
    layla.contextual.on("chatContextStartedThinking", onStartedThinking);
    // The div is mounted by the time this effect runs; taps before the engine
    // is ready are ignored by the handler.
    const stage = containerRef.current;
    stage?.addEventListener("pointerdown", onPointerTap);
    boot();

    return () => {
      cancelled = true;
      layla.contextual.off("chatContextSentimentUpdate", onSentimentUpdate);
      layla.contextual.off("chatContextStartedSpeaking", onStartedSpeaking);
      layla.contextual.off("chatContextFinishedSpeaking", onFinishedSpeaking);
      layla.contextual.off("chatContextStartedThinking", onStartedThinking);
      stage?.removeEventListener("pointerdown", onPointerTap);
      if (lookBackTimer !== undefined) clearTimeout(lookBackTimer);
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

      {versionUnsupported && (
        <div
          className="version-gate"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="version-gate-title"
        >
          <div className="version-gate__card">
            <svg
              className="version-gate__icon"
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <p id="version-gate-title" className="version-gate__title">
              This mini-app is only support on Layla v7.1.0 or above, please
              update your Layla app version!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
