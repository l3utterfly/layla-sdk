import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import { ProceduralIdle, type IdleSettings } from "./ProceduralIdle";

const DEG2RAD = Math.PI / 180;

type Vector3Tuple = [number, number, number];
type AnimationTarget = number | string;
type AnimationReturnTarget = AnimationTarget | "auto";
type BlinkPhase = "idle" | "closing" | "opening";
export type BackgroundAssetType = "image" | "glb";

export interface EntityTransform {
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: number;
}

export interface CameraTransform {
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  zoom: number;
}

export interface ViewerSettings {
  model: string;
  animations?: string[] | Record<string, string[]>;
  idle?: IdleSettings;
  animation?: {
    crossFadeDuration?: number;
  };
  camera?: {
    position?: Vector3Tuple;
    target?: Vector3Tuple;
    fov?: number;
  };
  zoom?: number;
  transform?: EntityTransform;
  background?: string | null;
  backgroundTransform?: EntityTransform;
  skybox?: string | null;
  lighting?: {
    environment?: boolean;
    ambientIntensity?: number;
    directionalIntensity?: number;
    directionalPosition?: Vector3Tuple;
  };
}

interface ActivateOptions {
  fade?: number;
  loop?: boolean;
  clamp?: boolean;
}

interface BlinkState {
  phase: BlinkPhase;
  timer: number;
  t: number;
  next: number;
}

interface ExpressionOverrideState {
  current: number;
  from: number;
  target: number;
  elapsed: number;
  age: number;
  expiring: boolean;
  releaseWhenZero: boolean;
}

const _isImagePath = (v: unknown): v is string =>
  typeof v === "string" && /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(v);

const _isGlbPath = (v: unknown): v is string =>
  typeof v === "string" && /\.glb(?:[?#].*)?$/i.test(v);

const _clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Manual expressions cross-fade and are fully released after five seconds so
// a stale sentiment can never remain stuck on the avatar's face.
const EXPRESSION_FADE_DURATION = 0.35;
const EXPRESSION_MAX_DURATION = 5;

// Randomized idle time between blinks, in seconds.
const _randomBlinkDelay = () => 2.5 + Math.random() * 3.5;

// Randomized procedural-idle time before an ambient neutral clip, in seconds.
const _randomNeutralDelay = () => 15 + Math.random() * 15;

// "/models/wave.vrma" -> "wave"
const _basename = (path: string) =>
  path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;

/**
 * Renders a single VRM avatar as an ambient, non-interactive background.
 * Everything is driven by the settings object (loaded from /settings.json).
 * There are no user controls — the camera is fixed and the avatar alternates
 * between procedural idling and occasional neutral animations.
 */
export class ViewerEngine {
  private readonly container: HTMLDivElement;
  private readonly settings: ViewerSettings;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private vrm: VRM | null = null;
  private _modelTransform: EntityTransform;
  private _backgroundTransform: EntityTransform;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions: THREE.AnimationAction[] = [];
  private activeAction: THREE.AnimationAction | null = null;
  private activeIndex = -1;
  private readonly _indexByName = new Map<string, number>();
  private readonly _neutralIndices: number[] = [];
  private proceduralIdle: ProceduralIdle | null = null;
  private _ambientEnabled = true;
  private _ambientTimer = _randomNeutralDelay();
  private _lastNeutralIndex = -1;
  private _returnTo: AnimationReturnTarget | null = null;
  private _timeScale = 1;
  private _raf: number | null = null;
  private _disposed = false;
  private _autoBlink = true;
  private _blinkWeight = 0;
  private readonly _blink: BlinkState = {
    phase: "idle",
    timer: 0,
    t: 0,
    next: _randomBlinkDelay(),
  };
  private readonly _overrides = new Map<string, ExpressionOverrideState>();
  private readonly _managed = new Set<string>(["blink"]);
  private _releaseNext: Set<string> | null = null;
  private _envTex?: THREE.Texture;
  private _bgTex?: THREE.Texture;
  private _skyboxTex?: THREE.Texture;
  private _backgroundModel?: THREE.Object3D;
  private _cameraTarget?: THREE.Vector3;

  constructor(container: HTMLDivElement, settings: ViewerSettings) {
    this.container = container;
    this.settings = settings;
    this._modelTransform = settings.transform ?? {};
    this._backgroundTransform = settings.backgroundTransform ?? {};

    // --- procedural face state (blinking + expression overrides) ---
    // Auto-blink is on by default so the avatar feels alive. Any expression you
    // drive via setExpression() takes precedence, cross-fades from the current
    // weight, and is re-applied every frame for at most five seconds.
    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLighting();

    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);
  }

  /* ------------------------------------------------------------------ setup */

  _initRenderer() {
    const bg = this.settings.background ?? "transparent";
    const hasSkybox =
      typeof this.settings.skybox === "string" &&
      this.settings.skybox.trim().length > 0;
    const transparent = !hasSkybox && (bg === "transparent" || bg === null);
    // A solid color = any string that isn't a keyword or an image path.
    const isColor =
      !transparent &&
      bg !== "environment" &&
      !_isImagePath(bg) &&
      !_isGlbPath(bg);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: transparent,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this._width(), this._height());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if (transparent) {
      this.renderer.setClearColor(0x000000, 0);
    } else if (isColor) {
      this.renderer.setClearColor(new THREE.Color(bg), 1);
    } else {
      // "environment", an image, or a GLB scene: clear to black underneath.
      // Image/environment backdrops are assigned in _initScene(), while a GLB
      // is added as scene geometry in load().
      this.renderer.setClearColor(0x000000, 1);
    }

    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    const bg = this.settings.background ?? "transparent";
    const hasSkybox =
      typeof this.settings.skybox === "string" &&
      this.settings.skybox.trim().length > 0;
    const wantEnvLighting = this.settings.lighting?.environment !== false;
    const wantEnvBackground = !hasSkybox && bg === "environment";

    // RoomEnvironment feeds scene.environment (image-based lighting), and can
    // optionally be shown as the visible backdrop via scene.background.
    if (wantEnvLighting || wantEnvBackground) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = envTex; // lighting / reflections
      if (wantEnvBackground) this.scene.background = envTex; // drawn backdrop
      this._envTex = envTex;
      pmrem.dispose();
    }

    // An image path is drawn as the backdrop (stretched to fill the viewport).
    if (!hasSkybox && _isImagePath(bg)) {
      const tex = new THREE.TextureLoader().load(bg);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
      this._bgTex = tex;
    }
  }

  _initCamera() {
    const cam = this.settings.camera ?? {};
    const fov = cam.fov ?? 30;
    this.camera = new THREE.PerspectiveCamera(
      fov,
      this._width() / this._height(),
      0.1,
      100
    );
    this._applyCamera();
  }

  _applyCamera() {
    const cam = this.settings.camera ?? {};
    this.setCameraTransform({
      position: cam.position ?? [0, 1.25, 2.6],
      target: cam.target ?? [0, 1.1, 0],
      fov: cam.fov ?? 30,
      zoom:
        this.settings.zoom && this.settings.zoom > 0 ? this.settings.zoom : 1,
    });
  }

  _initLighting() {
    const l = this.settings.lighting ?? {};

    const ambient = new THREE.AmbientLight(
      0xffffff,
      l.ambientIntensity ?? 1.2
    );
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(
      0xffffff,
      l.directionalIntensity ?? 1.6
    );
    // A directional light's distance does not affect its intensity, but moving
    // it away from the origin gives its shadow camera room to cover the avatar.
    dir.position
      .set(...(l.directionalPosition ?? [1, 1.5, 1]))
      .normalize()
      .multiplyScalar(10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = -0.0001;
    dir.shadow.normalBias = 0.02;
    dir.shadow.camera.near = 0.1;
    dir.shadow.camera.far = 30;
    dir.shadow.camera.left = -5;
    dir.shadow.camera.right = 5;
    dir.shadow.camera.top = 5;
    dir.shadow.camera.bottom = -5;
    this.scene.add(dir);
  }

  /* ----------------------------------------------------------------- loading */

  private _createLoader() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    return loader;
  }

  async load() {
    const skybox = this.settings.skybox;
    if (typeof skybox === "string" && skybox.trim().length > 0) {
      await this.loadSkybox(skybox);
    }

    const background = this.settings.background;
    if (_isGlbPath(background)) {
      await this.loadBackground(background, "glb");
    }

    await this.loadModel(this.settings.model);
    return this;
  }

  /** Replace the equirectangular skybox while keeping any 3D background. */
  async loadSkybox(imageUrl: string) {
    const texture = await new THREE.TextureLoader().loadAsync(imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;

    this._bgTex?.dispose();
    this._skyboxTex?.dispose();
    this._bgTex = undefined;
    this._skyboxTex = texture;
    this.scene.background = texture;
    this.renderer.setClearColor(0x000000, 1);
    return this;
  }

  /** Remove the skybox without disturbing any 3D background geometry. */
  removeSkybox() {
    const skybox = this._skyboxTex;
    this._skyboxTex = undefined;
    if (this.scene.background === skybox) {
      this.scene.background = this._bgTex ?? null;
    }
    skybox?.dispose();
    return this;
  }

  /** Replace the flat-image or GLB background while preserving the avatar. */
  async loadBackground(
    assetUrl: string,
    type: BackgroundAssetType,
    transform: EntityTransform = this._backgroundTransform,
  ) {
    this._backgroundTransform = transform;

    if (type === "image") {
      const texture = await new THREE.TextureLoader().loadAsync(assetUrl);
      texture.colorSpace = THREE.SRGBColorSpace;

      const previousModel = this._backgroundModel;
      this._backgroundModel = undefined;
      if (previousModel) {
        this.scene.remove(previousModel);
        VRMUtils.deepDispose(previousModel);
      }

      this._bgTex?.dispose();
      this._skyboxTex?.dispose();
      this._bgTex = texture;
      this._skyboxTex = undefined;
      this.scene.background = texture;
      this.renderer.setClearColor(0x000000, 1);
      return this;
    }

    const gltf = await new GLTFLoader().loadAsync(assetUrl);
    const backgroundModel = gltf.scene;
    this._applyTransform(backgroundModel, this._backgroundTransform);
    backgroundModel.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const previousModel = this._backgroundModel;
    this._backgroundModel = backgroundModel;
    this.scene.add(backgroundModel);
    if (previousModel) {
      this.scene.remove(previousModel);
      VRMUtils.deepDispose(previousModel);
    }

    if (!this._skyboxTex) {
      this._bgTex?.dispose();
      this._bgTex = undefined;
      this.scene.background = null;
    }
    this.renderer.setClearColor(0x000000, 1);
    return this;
  }

  /** Remove the flat-image or GLB background without disturbing the skybox. */
  removeBackground() {
    const backgroundModel = this._backgroundModel;
    this._backgroundModel = undefined;
    if (backgroundModel) {
      this.scene.remove(backgroundModel);
      VRMUtils.deepDispose(backgroundModel);
    }

    const backgroundTexture = this._bgTex;
    this._bgTex = undefined;
    this.scene.background = this._skyboxTex ?? null;
    backgroundTexture?.dispose();
    if (!this._skyboxTex) this.renderer.setClearColor(0x000000, 0);
    return this;
  }

  /** Replace the current avatar while preserving the rest of the scene. */
  async loadModel(
    modelUrl: string,
    transform: EntityTransform = this._modelTransform,
  ) {
    if (!modelUrl) throw new Error('settings.json is missing a "model" path.');
    this._modelTransform = transform;

    const loader = this._createLoader();
    const gltf = await loader.loadAsync(modelUrl);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      VRMUtils.deepDispose(gltf.scene);
      throw new Error("The selected file does not contain VRM data.");
    }

    // Optimizations (safe no-ops if not applicable)
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    // VRM 0.x avatars face -Z; rotate them so they face the camera like VRM 1.0.
    VRMUtils.rotateVRM0(vrm);

    // Frustum culling can clip spring-bone-driven meshes; disable to be safe.
    // Every avatar mesh casts onto any GLB background geometry beneath it.
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if (obj instanceof THREE.Mesh) obj.castShadow = true;
    });

    // --- animations ---
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixer.addEventListener("finished", (e) => this._onActionFinished(e));
    const actions: THREE.AnimationAction[] = [];
    const indexByName = new Map<string, number>();
    const neutralIndices: number[] = [];

    const configuredAnimations = this.settings.animations ?? [];
    const animPaths = Array.isArray(configuredAnimations)
      ? configuredAnimations
      : [...new Set(Object.values(configuredAnimations).flat())];
    for (const path of animPaths) {
      try {
        const animGltf = await loader.loadAsync(path);
        const vrmAnim = animGltf.userData.vrmAnimations?.[0] as
          | VRMAnimation
          | undefined;
        if (!vrmAnim) {
          console.warn(`No VRMA animation found in ${path}, skipping.`);
          continue;
        }
        const clip = createVRMAnimationClip(vrmAnim, vrm);
        clip.name = path;
        const index = actions.push(mixer.clipAction(clip)) - 1;
        // Let callers reference clips by full path or just the basename
        // (e.g. "wave" for "/models/wave.vrma").
        indexByName.set(path, index);
        indexByName.set(_basename(path), index);
      } catch (err) {
        console.warn(`Failed to load animation ${path}:`, err);
      }
    }

    const neutralPaths = Array.isArray(configuredAnimations)
      ? configuredAnimations
      : configuredAnimations.neutral ?? [];
    for (const path of neutralPaths) {
      const index = indexByName.get(path);
      if (index !== undefined && !neutralIndices.includes(index)) {
        neutralIndices.push(index);
      }
    }

    const previousVrm = this.vrm;
    const previousMixer = this.mixer;

    previousMixer?.stopAllAction();
    this.activeAction = null;
    this.activeIndex = -1;
    this._returnTo = null;
    this._ambientEnabled = true;
    this._ambientTimer = _randomNeutralDelay();
    this._lastNeutralIndex = -1;

    this.actions.splice(0, this.actions.length, ...actions);
    this._indexByName.clear();
    for (const [name, index] of indexByName) {
      this._indexByName.set(name, index);
    }
    this._neutralIndices.splice(
      0,
      this._neutralIndices.length,
      ...neutralIndices,
    );

    this._applyTransform(vrm.scene, this._modelTransform);
    this.vrm = vrm;
    this.mixer = mixer;
    this.proceduralIdle = new ProceduralIdle(vrm, this.settings.idle);
    this.scene.add(vrm.scene);

    if (previousVrm) {
      this.scene.remove(previousVrm.scene);
      previousMixer?.uncacheRoot(previousVrm.scene);
      VRMUtils.deepDispose(previousVrm.scene);
    }

    return this;
  }

  private _applyTransform(
    root: THREE.Object3D,
    t: EntityTransform = {},
  ) {
    const [px, py, pz] = t.position ?? [0, 0, 0];
    const [rx, ry, rz] = t.rotation ?? [0, 0, 0];
    const scale = t.scale ?? 1;

    root.position.set(px, py, pz);
    // rotation is authored in degrees for readability in settings.json
    root.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    root.scale.setScalar(scale);
  }

  /** Apply a model transform immediately without restarting the viewer. */
  setModelTransform(transform: EntityTransform) {
    this._modelTransform = transform;
    if (this.vrm) this._applyTransform(this.vrm.scene, transform);
    return this;
  }

  /** Apply a GLB background transform immediately without restarting. */
  setBackgroundTransform(transform: EntityTransform) {
    this._backgroundTransform = transform;
    if (this._backgroundModel) {
      this._applyTransform(this._backgroundModel, transform);
    }
    return this;
  }

  /** Update the camera framing immediately without restarting the viewer. */
  setCameraTransform(transform: CameraTransform) {
    const target = new THREE.Vector3(...transform.target);
    const position = new THREE.Vector3(...transform.position);
    const zoom = transform.zoom > 0 ? transform.zoom : 1;

    // Zoom dollies along the position-to-target direction. The target is the
    // camera's practical rotation control because lookAt() owns its rotation.
    const dir = position.clone().sub(target).divideScalar(zoom);
    this.camera.position.copy(target.clone().add(dir));
    this.camera.lookAt(target);
    this.camera.fov = Math.min(179, Math.max(1, transform.fov));
    this.camera.updateProjectionMatrix();
    this._cameraTarget = target;
    return this;
  }

  /* -------------------------------------------------------------- animation */

  /**
   * Core blend. Cross-fades from the current action to `index`, interrupting
   * whatever is playing. `loop` repeats the clip; otherwise it plays once.
   * Because the mixer sums actions by weight, overlapping the fade-in and
   * fade-out is what makes the transition look continuous.
   */
  private _activate(
    index: number,
    { fade = 0.4, loop = true, clamp = !loop }: ActivateOptions = {},
  ) {
    const next = this.actions[index];
    if (!next) return null;

    // Fade the procedural pose out over the same interval that the mixer fades
    // the clip in, so neither side snaps or wins the transition too early.
    this.proceduralIdle?.setBasePose(false, fade);
    const prev = this.activeAction;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = clamp;
    next.reset().setEffectiveTimeScale(this._timeScale).setEffectiveWeight(1);

    if (fade > 0 && prev !== next) {
      next.fadeIn(fade).play();
      prev?.fadeOut(fade);
    } else {
      if (prev && prev !== next) prev.stop();
      next.play();
    }

    this.activeAction = next;
    this.activeIndex = index;
    return next;
  }

  private _onActionFinished(e: { action: THREE.AnimationAction }) {
    // Ignore stray events from clips we've already faded away from.
    if (e && e.action !== this.activeAction) return;

    const a = this.settings.animation ?? {};
    const fade = a.crossFadeDuration ?? 0.4;

    // A one-shot (playOnce) just ended — hand control back.
    if (this._returnTo !== null) {
      const target = this._returnTo;
      this._returnTo = null;
      if (target === "auto") {
        this._resumeIdle(fade);
      } else {
        this._ambientEnabled = false;
        const i = this._resolveIndex(target);
        if (i >= 0) this._activate(i, { fade, loop: true });
      }
      return;
    }
  }

  private _resumeIdle(fade: number) {
    this.activeAction?.fadeOut(fade);
    this.activeAction = null;
    this.activeIndex = -1;
    this.proceduralIdle?.setBasePose(true, fade);
    this._ambientTimer = _randomNeutralDelay();
  }

  private _updateAmbient(delta: number) {
    if (
      !this._ambientEnabled ||
      this.activeAction ||
      this._neutralIndices.length === 0
    ) {
      return;
    }

    this._ambientTimer -= delta;
    if (this._ambientTimer > 0) return;

    let index = this._neutralIndices[0];
    if (this._neutralIndices.length > 1) {
      do {
        index = this._neutralIndices[
          Math.floor(Math.random() * this._neutralIndices.length)
        ];
      } while (index === this._lastNeutralIndex);
    }

    this._lastNeutralIndex = index;
    this._returnTo = "auto";
    const fade = this.settings.animation?.crossFadeDuration ?? 0.4;
    this._activate(index, { fade, loop: false });
  }

  private _resolveIndex(target: AnimationTarget) {
    if (typeof target === "number") {
      return target >= 0 && target < this.actions.length ? target : -1;
    }
    if (typeof target === "string") {
      const exactIndex = this._indexByName.get(target);
      if (exactIndex !== undefined) return exactIndex;
      // Fall back to a loose match on the clip path.
      for (const [name, i] of this._indexByName) {
        if (name.includes(target)) return i;
      }
    }
    return -1;
  }

  /* ---- public playback API (drive these from window.avatar) --------------- */

  /**
   * Cross-fade to an animation now, interrupting the current one. `target` is an
   * index, a full path, or a basename like "wave". This takes over from the
   * procedural idle until you call resumeAuto().
   *   avatar.play("wave", { fade: 0.3, loop: true })
   */
  play(target: AnimationTarget, { fade = 0.4, loop = true }: ActivateOptions = {}) {
    const i = this._resolveIndex(target);
    if (i < 0) {
      console.warn(`play(): no animation matching "${target}"`);
      return null;
    }
    this._ambientEnabled = false;
    this._returnTo = null;
    return this._activate(i, { fade, loop });
  }

  /**
   * Play an animation once, then flow back. By default it returns to the
   * procedural idle ("auto"); pass a target to settle on that clip.
   * Ideal for gestures that interrupt an idle:
   *   avatar.playOnce("wave")                     // wave, then resume idling
   *   avatar.playOnce("point", { returnTo: "idle" })
   */
  playOnce(
    target: AnimationTarget,
    { fade = 0.3, returnTo = "auto" }: {
      fade?: number;
      returnTo?: AnimationReturnTarget;
    } = {},
  ) {
    const i = this._resolveIndex(target);
    if (i < 0) {
      console.warn(`playOnce(): no animation matching "${target}"`);
      return null;
    }
    this._ambientEnabled = returnTo === "auto";
    this._returnTo = returnTo;
    return this._activate(i, { fade, loop: false });
  }

  /** Pick and play one random animation from a configured settings group. */
  playRandomFromGroup(
    group: string,
    { fade = 0.3, returnTo = "auto" }: {
      fade?: number;
      returnTo?: AnimationReturnTarget;
    } = {},
  ) {
    const configuredAnimations = this.settings.animations;
    const targets =
      configuredAnimations && !Array.isArray(configuredAnimations)
        ? configuredAnimations[group]
        : undefined;

    if (!targets?.length) {
      console.warn(
        `playRandomFromGroup(): no animations configured for "${group}"`,
      );
      return null;
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    return this.playOnce(target, { fade, returnTo });
  }

  /** Return control to the procedural-idle/ambient-neutral cycle. */
  resumeAuto({ fade = 0.4 }: { fade?: number } = {}) {
    this._ambientEnabled = true;
    this._returnTo = null;
    this._resumeIdle(fade);
    return this;
  }

  /** Fade the avatar to a rest (no animation playing). */
  stop({ fade = 0.4 }: { fade?: number } = {}) {
    this._ambientEnabled = false;
    this._returnTo = null;
    if (this.activeAction) {
      this.activeAction.fadeOut(fade);
      this.activeAction = null;
      this.activeIndex = -1;
    }
    this.proceduralIdle?.setBasePose(true, fade);
    return this;
  }

  /** Global playback speed for the active animation (1 = normal). */
  setSpeed(scale: number) {
    this._timeScale = scale;
    this.activeAction?.setEffectiveTimeScale(scale);
    return this;
  }

  /** Names of the loaded animations, in order — handy for discovering targets. */
  getAnimations() {
    return this.actions.map((act) => act.getClip().name);
  }

  /* ------------------------------------------------------------------- face */
  // Public API for driving eyes and mouth. All expression names are VRM preset
  // names, so they work across VRM 0.x and 1.0 models: eyes use "blink" (or
  // "blinkLeft" / "blinkRight"); the mouth/visemes use "aa", "ih", "ou", "ee",
  // "oh"; emotions use "happy", "angry", "sad", "relaxed", "surprised". Weights
  // are 0..1. Whatever you set here is cross-faded and overrides any expression
  // the current animation might touch for at most five seconds.

  /** Enable/disable the automatic ambient blink. Turn off to drive eyes yourself. */
  setAutoBlink(enabled: boolean) {
    this._autoBlink = !!enabled;
    if (!enabled) this._blinkWeight = 0;
    return this;
  }

  /** Trigger a single blink now (works whether or not auto-blink is on). */
  blink() {
    this._blink.phase = "closing";
    this._blink.t = 0;
    return this;
  }

  /** Cross-fade one expression to a weight (0..1) for at most five seconds. */
  setExpression(name: string, weight: number) {
    const previous = this._overrides.get(name);
    const current = previous?.current ?? this._getExpressionWeight(name);

    this._overrides.set(name, {
      current,
      from: current,
      target: _clamp01(weight),
      elapsed: 0,
      age: 0,
      expiring: false,
      releaseWhenZero: false,
    });
    this._managed.add(name);
    this._releaseNext?.delete(name);
    return this;
  }

  /** Set several expressions at once, e.g. { happy: 1, aa: 0.3 }. */
  setExpressions(map: Record<string, number>) {
    for (const [name, weight] of Object.entries(map)) this.setExpression(name, weight);
    return this;
  }

  /** Fade an expression out, then stop driving it. */
  clearExpression(name: string) {
    const previous = this._overrides.get(name);
    const current = previous?.current ?? this._getExpressionWeight(name);

    this._overrides.set(name, {
      current,
      from: current,
      target: 0,
      elapsed: 0,
      age: 0,
      expiring: false,
      releaseWhenZero: true,
    });
    this._managed.add(name);
    this._releaseNext?.delete(name);
    return this;
  }

  /**
   * Open the mouth by `amount` (0..1). Maps to the "aa" viseme — good enough for
   * amplitude-based lip sync: feed it your audio's normalized volume per frame.
   */
  setMouthOpen(amount: number) {
    return this.setExpression("aa", amount);
  }

  /**
   * Set a specific mouth shape. `vowel` is one of aa|ih|ou|ee|oh. Clears the
   * other vowel visemes so shapes don't stack.
   */
  setViseme(vowel: "aa" | "ih" | "ou" | "ee" | "oh", weight = 1) {
    for (const v of ["aa", "ih", "ou", "ee", "oh"]) {
      if (v === vowel) this.setExpression(v, weight);
      else this.clearExpression(v);
    }
    return this;
  }

  /** Close the mouth (clears all vowel visemes). */
  closeMouth() {
    for (const v of ["aa", "ih", "ou", "ee", "oh"]) this.clearExpression(v);
    return this;
  }

  private _applyFace(delta: number) {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    this._updateBlink(delta);
    this._updateExpressionOverrides(delta);

    for (const name of this._managed) {
      let weight = 0;
      if (this._overrides.has(name)) {
        weight = this._overrides.get(name)?.current ?? 0;
      } else if (name === "blink" && this._autoBlink) {
        weight = this._blinkWeight;
      }
      // setValue is a no-op for expressions the model doesn't define.
      if (em.getExpression(name)) em.setValue(name, weight);
    }

    // Drop released expressions after they've been zeroed once this frame.
    if (this._releaseNext) {
      for (const name of this._releaseNext) {
        if (name !== "blink") this._managed.delete(name);
      }
      this._releaseNext = null;
    }
  }

  private _getExpressionWeight(name: string) {
    const value = this.vrm?.expressionManager?.getValue(name);
    return _clamp01(typeof value === "number" ? value : 0);
  }

  private _advanceExpressionTransition(
    state: ExpressionOverrideState,
    delta: number,
  ) {
    state.elapsed = Math.min(
      state.elapsed + Math.max(delta, 0),
      EXPRESSION_FADE_DURATION,
    );
    const progress = _clamp01(state.elapsed / EXPRESSION_FADE_DURATION);
    // Smoothstep avoids a visible speed change at either end of the fade.
    const eased = progress * progress * (3 - 2 * progress);
    state.current = THREE.MathUtils.lerp(state.from, state.target, eased);
  }

  private _updateExpressionOverrides(delta: number) {
    const fadeStart = EXPRESSION_MAX_DURATION - EXPRESSION_FADE_DURATION;

    for (const [name, state] of this._overrides) {
      const previousAge = state.age;
      const nextAge = previousAge + Math.max(delta, 0);

      if (
        !state.releaseWhenZero &&
        !state.expiring &&
        nextAge >= fadeStart
      ) {
        // Advance to the exact start of the expiry fade, then spend the rest
        // of this frame fading out. This remains correct even after a long
        // frame or when the tab has briefly been suspended.
        const beforeFade = Math.max(fadeStart - previousAge, 0);
        this._advanceExpressionTransition(state, beforeFade);
        state.from = state.current;
        state.target = 0;
        state.elapsed = 0;
        state.expiring = true;
        this._advanceExpressionTransition(state, nextAge - fadeStart);
      } else {
        this._advanceExpressionTransition(state, delta);
      }

      state.age = nextAge;
      const expired =
        !state.releaseWhenZero && state.age >= EXPRESSION_MAX_DURATION;
      const cleared =
        state.releaseWhenZero &&
        state.target === 0 &&
        state.elapsed >= EXPRESSION_FADE_DURATION;

      if (expired || cleared) {
        state.current = 0;
        this._overrides.delete(name);
        // Keep it managed for this frame so the zero is applied before the
        // underlying animation or procedural expression regains control.
        this._releaseNext ??= new Set<string>();
        this._releaseNext.add(name);
      }
    }
  }

  private _updateBlink(delta: number) {
    const b = this._blink;

    // If auto-blink is off and no manual blink is mid-flight, hold eyes open.
    if (!this._autoBlink && b.phase === "idle") {
      this._blinkWeight = 0;
      return;
    }

    if (b.phase === "idle") {
      b.timer += delta;
      this._blinkWeight = 0;
      if (b.timer >= b.next) {
        b.phase = "closing";
        b.t = 0;
        b.timer = 0;
      }
      return;
    }

    const CLOSE = 0.07; // seconds to close the lids
    const OPEN = 0.12; // seconds to reopen
    b.t += delta;

    if (b.phase === "closing") {
      this._blinkWeight = _clamp01(b.t / CLOSE);
      if (b.t >= CLOSE) {
        b.phase = "opening";
        b.t = 0;
      }
    } else {
      // opening
      this._blinkWeight = _clamp01(1 - b.t / OPEN);
      if (b.t >= OPEN) {
        b.phase = "idle";
        b.next = _randomBlinkDelay();
        this._blinkWeight = 0;
      }
    }
  }

  /* -------------------------------------------------------------- main loop */

  start() {
    const tick = () => {
      if (this._disposed) return;
      this._raf = requestAnimationFrame(tick);

      const delta = this.clock.getDelta();
      this._updateAmbient(delta);
      this.vrm?.humanoid.resetNormalizedPose();
      this.mixer?.update(delta);
      this.proceduralIdle?.update(delta);
      // Apply blinking + expression overrides after the animation mixer (so
      // manual control wins) and before vrm.update (which pushes weights to the
      // mesh, and also drives spring bones, look-at and expression morphs).
      this._applyFace(delta);
      this.vrm?.update(delta);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** Copy the currently rendered Three.js frame without any surrounding UI. */
  captureFrame() {
    if (this._disposed) throw new Error("Cannot capture a disposed viewer.");

    // Render immediately so the copy does not depend on WebGL's drawing buffer
    // still being available from the previous animation frame.
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const frame = document.createElement("canvas");
    frame.width = source.width;
    frame.height = source.height;
    const context = frame.getContext("2d");
    if (!context) throw new Error("Could not create the screenshot canvas.");
    context.drawImage(source, 0, 0);
    return frame;
  }

  /* ---------------------------------------------------------------- helpers */

  _width() {
    return this.container.clientWidth || window.innerWidth;
  }

  _height() {
    return this.container.clientHeight || window.innerHeight;
  }

  _onResize() {
    if (this._disposed) return;
    this.camera.aspect = this._width() / this._height();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this._width(), this._height());
  }

  dispose() {
    this._disposed = true;
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.mixer?.stopAllAction();
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    if (this._backgroundModel) VRMUtils.deepDispose(this._backgroundModel);
    this._envTex?.dispose?.();
    this._bgTex?.dispose?.();
    this._skyboxTex?.dispose?.();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
