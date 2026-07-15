import JSZip from "jszip";
import type {
  CameraTransform,
  EntityTransform,
  ViewerSettings,
} from "./viewer/ViewerEngine";

export interface ExportAsset {
  name: string;
  source: File | string;
}

export interface ExportArtwork {
  icon: Blob;
  cover: Blob;
}

export interface VrmExportOptions {
  settings: ViewerSettings;
  model: ExportAsset;
  background: ExportAsset | null;
  backgroundValue: string | null;
  skybox: ExportAsset | null;
  modelTransform: Required<EntityTransform>;
  backgroundTransform: Required<EntityTransform>;
  camera: CameraTransform;
  artwork: ExportArtwork;
}

const fetchFile = async (path: string) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not add ${path} to the export (${response.status}).`);
  }
  return response.arrayBuffer();
};

// The project stores its app metadata as public/app.json.
const fetchMetadata = () => fetchFile("/app.json");

const safeFileName = (name: string, fallback: string) => {
  const baseName = name.split(/[\\/]/).pop()?.trim() || fallback;
  const safeName = baseName
    .replace(/[\u0000-\u001f<>:"|?*#%]/g, "_")
    .replace(/[. ]+$/, "");
  return !safeName || safeName === "." || safeName === ".."
    ? fallback
    : safeName;
};

const addAsset = async (
  zip: JSZip,
  directory: "model" | "background" | "skybox",
  asset: ExportAsset,
) => {
  const name = safeFileName(asset.name, directory);
  const path = `assets/${directory}/${name}`;
  const content =
    typeof asset.source === "string"
      ? await fetchFile(asset.source)
      : await asset.source.arrayBuffer();
  zip.file(path, content);
  return path;
};

const animationFileName = (path: string) =>
  path.split(/[\\/]/).pop()?.split(/[?#]/)[0] || "animation.vrma";

const getUniqueFileName = (name: string, usedNames: Set<string>) => {
  const safeName = safeFileName(name, "animation.vrma");
  const extensionIndex = safeName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";
  let candidate = safeName;
  let suffix = 2;

  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }

  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
};

const addAnimations = async (
  zip: JSZip,
  animations: ViewerSettings["animations"],
): Promise<ViewerSettings["animations"]> => {
  if (!animations) return undefined;

  const configuredPaths = Array.isArray(animations)
    ? animations
    : Object.values(animations).flat();
  const uniquePaths = [...new Set(configuredPaths)];
  const usedNames = new Set<string>();
  const archivePaths = new Map<string, string>();

  const entries = uniquePaths.map((sourcePath) => {
    const fileName = getUniqueFileName(
      animationFileName(sourcePath),
      usedNames,
    );
    const archivePath = `animations/${fileName}`;
    archivePaths.set(sourcePath, archivePath);
    return { sourcePath, archivePath };
  });
  const contents = await Promise.all(
    entries.map(({ sourcePath }) => fetchFile(sourcePath)),
  );

  entries.forEach(({ archivePath }, index) => {
    zip.file(archivePath, contents[index]);
  });

  const rewrite = (paths: string[]) =>
    paths.map((path) => archivePaths.get(path) ?? path);

  if (Array.isArray(animations)) return rewrite(animations);
  return Object.fromEntries(
    Object.entries(animations).map(([group, paths]) => [group, rewrite(paths)]),
  );
};

const buildAppMetadata = (source: ArrayBuffer, modelName: string) => {
  const metadata = JSON.parse(new TextDecoder().decode(source)) as Record<
    string,
    unknown
  >;
  return {
    ...metadata,
    title: safeFileName(modelName, "VRM character").replace(/\.vrm$/i, ""),
    tagline: "Custom VRM character",
    description:
      "This mini-app is designed to be used as an animated character background",
  };
};

const canvasToJpeg = (canvas: HTMLCanvasElement, quality = 0.9) =>
  new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The rendered image could not be encoded."));
        },
        "image/jpeg",
        quality,
      );
    } catch (err) {
      reject(err);
    }
  });

export async function captureViewerArtwork(frame: HTMLCanvasElement) {
  if (!frame.width || !frame.height) {
    throw new Error("The rendered view is empty and cannot be captured.");
  }

  const icon = document.createElement("canvas");
  icon.width = 512;
  icon.height = 512;
  const context = icon.getContext("2d");
  if (!context) throw new Error("Could not create the app icon canvas.");

  const topRegionHeight = frame.height / 2;
  const cropSize = Math.min(frame.width, topRegionHeight);
  const cropX = (frame.width - cropSize) / 2;
  const cropY = (topRegionHeight - cropSize) / 2;
  context.drawImage(
    frame,
    cropX,
    cropY,
    cropSize,
    cropSize,
    0,
    0,
    icon.width,
    icon.height,
  );

  const [iconBlob, coverBlob] = await Promise.all([
    canvasToJpeg(icon, 0.92),
    canvasToJpeg(frame, 0.9),
  ]);
  return { icon: iconBlob, cover: coverBlob } satisfies ExportArtwork;
}

export async function buildVrmExportArchive({
  settings,
  model,
  background,
  backgroundValue,
  skybox,
  modelTransform,
  backgroundTransform,
  camera,
  artwork,
}: VrmExportOptions) {
  const zip = new JSZip();

  const [
    modelPath,
    backgroundPath,
    skyboxPath,
    animations,
    metadataSource,
    indexHtml,
    icon,
    cover,
  ] =
    await Promise.all([
      addAsset(zip, "model", model),
      background ? addAsset(zip, "background", background) : null,
      skybox ? addAsset(zip, "skybox", skybox) : null,
      addAnimations(zip, settings.animations),
      fetchMetadata(),
      fetchFile("/index.html"),
      artwork.icon.arrayBuffer(),
      artwork.cover.arrayBuffer(),
    ]);

  const exportedSettings: ViewerSettings = {
    ...settings,
    model: modelPath,
    animations,
    camera: {
      ...settings.camera,
      position: [...camera.position],
      target: [...camera.target],
      fov: camera.fov,
    },
    zoom: camera.zoom,
    transform: {
      position: [...modelTransform.position],
      rotation: [...modelTransform.rotation],
      scale: modelTransform.scale,
    },
    background: backgroundPath ?? backgroundValue,
    backgroundTransform: {
      position: [...backgroundTransform.position],
      rotation: [...backgroundTransform.rotation],
      scale: backgroundTransform.scale,
    },
    skybox: skyboxPath,
  };

  const metadata = buildAppMetadata(metadataSource, model.name);

  zip.file("settings.json", `${JSON.stringify(exportedSettings, null, 2)}\n`);
  zip.file("app.json", `${JSON.stringify(metadata, null, 2)}\n`);
  zip.file("index.html", indexHtml);
  zip.file("icon.jpg", icon);
  zip.file("bg.jpg", cover);

  // VRM, GLB, and image files are already compressed. STORE avoids an expensive
  // second compression pass and keeps large-model exports responsive.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function downloadArchive(blob: Blob, modelName: string) {
  const stem = safeFileName(modelName, "avatar").replace(/\.[^.]+$/, "");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${stem || "avatar"}-vrm-export.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
