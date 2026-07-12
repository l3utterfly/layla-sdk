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

const DEG2RAD = Math.PI / 180;

type Vector3Tuple = [number, number, number];
type AnimationTarget = number | string;
type AnimationReturnTarget = AnimationTarget | "auto";
type BlinkPhase = "idle" | "closing" | "opening";

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
  debug?: boolean;
  model: string;
  animations?: string[] | Record<string, string[]>;
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

const _isImagePath = (v: unknown): v is string =>
  typeof v === "string" && /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(v);

const _isGlbPath = (v: unknown): v is string =>
  typeof v === "string" && /\.glb(?:[?#].*)?$/i.test(v);

const _clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Randomized idle time between blinks, in seconds.
const _randomBlinkDelay = () => 2.5 + Math.random() * 3.5;

// "/models/wave.vrma" -> "wave"
const _basename = (path: string) =>
  path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;

/**
 * Renders a single VRM avatar as an ambient, non-interactive background.
 * Everything is driven by the settings object (loaded from /settings.json).
 * There are no user controls — the camera is fixed and the avatar idles using
 * random animations from the neutral group until the host app takes over.
 */
export class ViewerEngine {
  private readonly container: HTMLDivElement;
  private readonly settings: ViewerSettings;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions: THREE.AnimationAction[] = [];
  private activeAction: THREE.AnimationAction | null = null;
  private activeIndex = -1;
  private readonly _indexByName = new Map<string, number>();
  private readonly _neutralIndices: number[] = [];
  private _autoNeutral = false;
  private _returnTo: AnimationReturnTarget | null = null;
  private _resumeIndex = -1;
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
  private readonly _overrides = new Map<string, number>();
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

    // --- procedural face state (blinking + expression overrides) ---
    // Auto-blink is on by default so the avatar feels alive. Any expression you
    // drive via setExpression() takes precedence and is re-applied every frame.
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
    dir.position.set(...(l.directionalPosition ?? [1, 1.5, 1])).normalize();
    this.scene.add(dir);
  }

  /* ----------------------------------------------------------------- loading */

  async load() {
    const skybox = this.settings.skybox;
    if (typeof skybox === "string" && skybox.trim().length > 0) {
      const tex = await new THREE.TextureLoader().loadAsync(skybox);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = tex;
      this._skyboxTex = tex;
    }

    const background = this.settings.background;
    if (_isGlbPath(background)) {
      const backgroundGltf = await new GLTFLoader().loadAsync(background);
      this._backgroundModel = backgroundGltf.scene;
      this._applyTransform(
        this._backgroundModel,
        this.settings.backgroundTransform,
      );
      this.scene.add(this._backgroundModel);
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    // --- model ---
    const modelUrl = this.settings.model;
    if (!modelUrl) throw new Error('settings.json is missing a "model" path.');

    const gltf = await loader.loadAsync(modelUrl);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`No VRM data found in ${modelUrl}`);

    // Optimizations (safe no-ops if not applicable)
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    // VRM 0.x avatars face -Z; rotate them so they face the camera like VRM 1.0.
    VRMUtils.rotateVRM0(vrm);

    // Frustum culling can clip spring-bone-driven meshes; disable to be safe.
    vrm.scene.traverse((obj) => (obj.frustumCulled = false));

    this._applyTransform(vrm.scene, this.settings.transform);
    this.scene.add(vrm.scene);
    this.vrm = vrm;

    // --- animations ---
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener("finished", (e) => this._onActionFinished(e));

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
        const index = this.actions.push(this.mixer.clipAction(clip)) - 1;
        // Let callers reference clips by full path or just the basename
        // (e.g. "wave" for "/models/wave.vrma").
        this._indexByName.set(path, index);
        this._indexByName.set(_basename(path), index);
      } catch (err) {
        console.warn(`Failed to load animation ${path}:`, err);
      }
    }

    // Only neutral animations participate in ambient playback. Every other
    // group is loaded for explicit play()/playOnce() calls from the host app.
    const neutralPaths = Array.isArray(configuredAnimations)
      ? configuredAnimations
      : configuredAnimations.neutral ?? [];
    for (const path of neutralPaths) {
      const index = this._indexByName.get(path);
      if (index !== undefined && !this._neutralIndices.includes(index)) {
        this._neutralIndices.push(index);
      }
    }

    this._startPlayback();
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
    if (this.vrm) this._applyTransform(this.vrm.scene, transform);
    return this;
  }

  /** Apply a GLB background transform immediately without restarting. */
  setBackgroundTransform(transform: EntityTransform) {
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

  _startPlayback() {
    if (this._neutralIndices.length === 0) return;
    this._autoNeutral = true;
    this._playNextNeutral(0);
  }

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

    const prev = this.activeAction;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = clamp;
    next.reset().setEffectiveTimeScale(this._timeScale).setEffectiveWeight(1);

    if (fade > 0 && prev && prev !== next) {
      next.fadeIn(fade).play();
      prev.fadeOut(fade);
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
        if (this._neutralIndices.length > 0) {
          this._autoNeutral = true;
          this._playNextNeutral(fade);
        } else if (this._resumeIndex >= 0) {
          // No neutral idle is configured — flow back to the interrupted clip.
          this._activate(this._resumeIndex, { fade, loop: true });
        }
      } else {
        const i = this._resolveIndex(target);
        if (i >= 0) this._activate(i, { fade, loop: true });
      }
      return;
    }

    if (this._autoNeutral) this._playNextNeutral(fade);
  }

  private _playNextNeutral(fade: number) {
    if (this._neutralIndices.length === 0) return;

    // A lone idle loops. With multiple choices, pick randomly and avoid an
    // immediate repeat so ambient motion remains varied.
    if (this._neutralIndices.length === 1) {
      this._activate(this._neutralIndices[0], { fade, loop: true });
      return;
    }

    let next: number;
    do {
      next = this._neutralIndices[
        Math.floor(Math.random() * this._neutralIndices.length)
      ];
    } while (next === this.activeIndex);
    this._activate(next, { fade, loop: false });
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
   * automatic neutral idle until you call resumeAuto().
   *   avatar.play("wave", { fade: 0.3, loop: true })
   */
  play(target: AnimationTarget, { fade = 0.4, loop = true }: ActivateOptions = {}) {
    const i = this._resolveIndex(target);
    if (i < 0) {
      console.warn(`play(): no animation matching "${target}"`);
      return null;
    }
    this._autoNeutral = false;
    this._returnTo = null;
    return this._activate(i, { fade, loop });
  }

  /**
   * Play an animation once, then flow back. By default it returns to the
   * automatic neutral idle ("auto"); pass a target to settle on that clip.
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
    // Remember what we were doing so we can flow back to it afterwards.
    this._resumeIndex = this.activeIndex;
    this._autoNeutral = false;
    this._returnTo = returnTo;
    return this._activate(i, { fade, loop: false });
  }

  /** Return control to random playback from the configured neutral group. */
  resumeAuto({ fade = 0.4 }: { fade?: number } = {}) {
    this._returnTo = null;
    this._autoNeutral = this._neutralIndices.length > 0;
    if (this._autoNeutral) this._playNextNeutral(fade);
    return this;
  }

  /** Fade the avatar to a rest (no animation playing). */
  stop({ fade = 0.4 }: { fade?: number } = {}) {
    this._autoNeutral = false;
    this._returnTo = null;
    if (this.activeAction) {
      this.activeAction.fadeOut(fade);
      this.activeAction = null;
      this.activeIndex = -1;
    }
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
  // are 0..1. Whatever you set here is re-applied every frame and overrides any
  // expression the current animation might touch, until you clear it.

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

  /** Set one expression weight (0..1), re-applied every frame until cleared. */
  setExpression(name: string, weight: number) {
    this._overrides.set(name, _clamp01(weight));
    this._managed.add(name);
    return this;
  }

  /** Set several expressions at once, e.g. { happy: 1, aa: 0.3 }. */
  setExpressions(map: Record<string, number>) {
    for (const [name, weight] of Object.entries(map)) this.setExpression(name, weight);
    return this;
  }

  /** Stop driving an expression; its weight is released back to 0. */
  clearExpression(name: string) {
    this._overrides.delete(name);
    // Kept in _managed for one more frame so it gets zeroed, then dropped.
    this._releaseNext ??= new Set<string>();
    this._releaseNext.add(name);
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

    for (const name of this._managed) {
      let weight = 0;
      if (this._overrides.has(name)) weight = this._overrides.get(name) ?? 0;
      else if (name === "blink" && this._autoBlink) weight = this._blinkWeight;
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
      this.mixer?.update(delta);
      // Apply blinking + expression overrides after the animation mixer (so
      // manual control wins) and before vrm.update (which pushes weights to the
      // mesh, and also drives spring bones, look-at and expression morphs).
      this._applyFace(delta);
      this.vrm?.update(delta);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
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
