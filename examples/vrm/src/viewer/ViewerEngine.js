import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";

const DEG2RAD = Math.PI / 180;

const _isImagePath = (v) =>
  typeof v === "string" && /\.(png|jpe?g|webp)$/i.test(v);

const _clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Randomized idle time between blinks, in seconds.
const _randomBlinkDelay = () => 2.5 + Math.random() * 3.5;

// "/models/wave.vrma" -> "wave"
const _basename = (p) =>
  String(p).split("/").pop().replace(/\.[^.]+$/, "");

/**
 * Renders a single VRM avatar as an ambient, non-interactive background.
 * Everything is driven by the settings object (loaded from /settings.json).
 * There are no user controls — the camera is fixed and the avatar cycles
 * through its animations on its own.
 */
export class ViewerEngine {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;

    this.vrm = null;
    this.mixer = null;
    this.actions = [];
    this.activeAction = null;
    this.activeIndex = -1;
    this._indexByName = new Map(); // path + basename -> action index
    this._autoCycle = false; // does the finished-handler auto-advance?
    this._returnTo = null; // where a one-shot returns to when it ends
    this._resumeIndex = -1; // clip to fall back to after a one-shot
    this._timeScale = 1;

    this.clock = new THREE.Clock();
    this._raf = null;
    this._disposed = false;

    // --- procedural face state (blinking + expression overrides) ---
    // Auto-blink is on by default so the avatar feels alive. Any expression you
    // drive via setExpression() takes precedence and is re-applied every frame.
    this._autoBlink = true;
    this._blinkWeight = 0;
    this._blink = { phase: "idle", timer: 0, t: 0, next: _randomBlinkDelay() };
    this._overrides = new Map(); // name -> weight (0..1), applied every frame
    this._managed = new Set(["blink"]); // expressions we actively write each frame

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
    const transparent = bg === "transparent" || bg === null;
    // A solid color = any string that isn't a keyword or an image path.
    const isColor = !transparent && bg !== "environment" && !_isImagePath(bg);

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
      // "environment" or an image: the visible backdrop is set as
      // scene.background in _initScene(); clear to black underneath.
      this.renderer.setClearColor(0x000000, 1);
    }

    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();

    const bg = this.settings.background ?? "transparent";
    const wantEnvLighting = this.settings.lighting?.environment !== false;
    const wantEnvBackground = bg === "environment";

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
    if (_isImagePath(bg)) {
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
    const target = new THREE.Vector3(...(cam.target ?? [0, 1.1, 0]));
    const position = new THREE.Vector3(...(cam.position ?? [0, 1.25, 2.6]));

    // "zoom" dollies the camera along the view direction.
    // zoom = 1 -> configured position; > 1 -> closer; < 1 -> further away.
    const zoom = this.settings.zoom && this.settings.zoom > 0 ? this.settings.zoom : 1;
    const dir = position.clone().sub(target).divideScalar(zoom);

    this.camera.position.copy(target.clone().add(dir));
    this.camera.lookAt(target);
    this._cameraTarget = target;
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
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    // --- model ---
    const modelUrl = this.settings.model;
    if (!modelUrl) throw new Error('settings.json is missing a "model" path.');

    const gltf = await loader.loadAsync(modelUrl);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error(`No VRM data found in ${modelUrl}`);

    // Optimizations (safe no-ops if not applicable)
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    // VRM 0.x avatars face -Z; rotate them so they face the camera like VRM 1.0.
    VRMUtils.rotateVRM0(vrm);

    // Frustum culling can clip spring-bone-driven meshes; disable to be safe.
    vrm.scene.traverse((obj) => (obj.frustumCulled = false));

    this._applyTransform(vrm.scene);
    this.scene.add(vrm.scene);
    this.vrm = vrm;

    // --- animations ---
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.mixer.addEventListener("finished", (e) => this._onActionFinished(e));

    const animPaths = this.settings.animations ?? [];
    for (const path of animPaths) {
      try {
        const animGltf = await loader.loadAsync(path);
        const vrmAnim = animGltf.userData.vrmAnimations?.[0];
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

    this._startPlayback();
    return this;
  }

  _applyTransform(root) {
    const t = this.settings.transform ?? {};
    const [px, py, pz] = t.position ?? [0, 0, 0];
    const [rx, ry, rz] = t.rotation ?? [0, 0, 0];
    const scale = t.scale ?? 1;

    root.position.set(px, py, pz);
    // rotation is authored in degrees for readability in settings.json
    root.rotation.set(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
    root.scale.setScalar(scale);
  }

  /* -------------------------------------------------------------- animation */

  _startPlayback() {
    if (this.actions.length === 0) return;

    const a = this.settings.animation ?? {};
    const single = this.actions.length === 1 || a.mode === "single";
    const fade = a.crossFadeDuration ?? 0.4;

    let start = 0;
    if (a.randomizeStart) start = Math.floor(Math.random() * this.actions.length);

    if (single) {
      // Loop one clip forever; no auto-cycling.
      this._autoCycle = false;
      this._activate(start, { fade: 0, loop: true });
    } else {
      // Play each clip once, cross-fading to the next when it ends.
      this._autoCycle = true;
      this._activate(start, { fade: 0, loop: false });
    }
  }

  /**
   * Core blend. Cross-fades from the current action to `index`, interrupting
   * whatever is playing. `loop` repeats the clip; otherwise it plays once.
   * Because the mixer sums actions by weight, overlapping the fade-in and
   * fade-out is what makes the transition look continuous.
   */
  _activate(index, { fade = 0.4, loop = true, clamp = !loop } = {}) {
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

  _onActionFinished(e) {
    // Ignore stray events from clips we've already faded away from.
    if (e && e.action !== this.activeAction) return;

    const a = this.settings.animation ?? {};
    const fade = a.crossFadeDuration ?? 0.4;

    // A one-shot (playOnce) just ended — hand control back.
    if (this._returnTo !== null) {
      const target = this._returnTo;
      this._returnTo = null;
      if (target === "auto") {
        const canCycle = this.actions.length > 1 && a.mode !== "single";
        if (canCycle) {
          this._autoCycle = true;
          this._advanceAuto(fade);
        } else if (this._resumeIndex >= 0) {
          // Nothing to cycle through — flow back to the clip we interrupted.
          this._activate(this._resumeIndex, { fade, loop: true });
        }
      } else {
        const i = this._resolveIndex(target);
        if (i >= 0) this._activate(i, { fade, loop: true });
      }
      return;
    }

    if (this._autoCycle) this._advanceAuto(fade);
  }

  _advanceAuto(fade) {
    if (this.actions.length < 2) return;
    const a = this.settings.animation ?? {};

    let next;
    if (a.mode === "random") {
      do {
        next = Math.floor(Math.random() * this.actions.length);
      } while (next === this.activeIndex);
    } else {
      next = (this.activeIndex + 1) % this.actions.length;
    }
    this._activate(next, { fade, loop: false });
  }

  _resolveIndex(target) {
    if (typeof target === "number") {
      return target >= 0 && target < this.actions.length ? target : -1;
    }
    if (typeof target === "string") {
      if (this._indexByName.has(target)) return this._indexByName.get(target);
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
   * automatic sequence until you call resumeAuto().
   *   avatar.play("wave", { fade: 0.3, loop: true })
   */
  play(target, { fade = 0.4, loop = true } = {}) {
    const i = this._resolveIndex(target);
    if (i < 0) {
      console.warn(`play(): no animation matching "${target}"`);
      return null;
    }
    this._autoCycle = false;
    this._returnTo = null;
    return this._activate(i, { fade, loop });
  }

  /**
   * Play an animation once, then flow back. By default it returns to the
   * automatic sequence ("auto"); pass a specific target to settle on that clip.
   * Ideal for gestures that interrupt an idle:
   *   avatar.playOnce("wave")                     // wave, then resume idling
   *   avatar.playOnce("point", { returnTo: "idle" })
   */
  playOnce(target, { fade = 0.3, returnTo = "auto" } = {}) {
    const i = this._resolveIndex(target);
    if (i < 0) {
      console.warn(`playOnce(): no animation matching "${target}"`);
      return null;
    }
    // Remember what we were doing so we can flow back to it afterwards.
    this._resumeIndex = this.activeIndex;
    this._autoCycle = false;
    this._returnTo = returnTo;
    return this._activate(i, { fade, loop: false });
  }

  /** Resume automatic sequence/random cycling from the current clip. */
  resumeAuto({ fade = 0.4 } = {}) {
    const a = this.settings.animation ?? {};
    this._returnTo = null;
    this._autoCycle = this.actions.length > 1 && a.mode !== "single";
    if (this._autoCycle) this._advanceAuto(fade);
    return this;
  }

  /** Fade the avatar to a rest (no animation playing). */
  stop({ fade = 0.4 } = {}) {
    this._autoCycle = false;
    this._returnTo = null;
    if (this.activeAction) {
      this.activeAction.fadeOut(fade);
      this.activeAction = null;
      this.activeIndex = -1;
    }
    return this;
  }

  /** Global playback speed for the active animation (1 = normal). */
  setSpeed(scale) {
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
  setAutoBlink(enabled) {
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
  setExpression(name, weight) {
    this._overrides.set(name, _clamp01(weight));
    this._managed.add(name);
    return this;
  }

  /** Set several expressions at once, e.g. { happy: 1, aa: 0.3 }. */
  setExpressions(map) {
    for (const [name, weight] of Object.entries(map)) this.setExpression(name, weight);
    return this;
  }

  /** Stop driving an expression; its weight is released back to 0. */
  clearExpression(name) {
    this._overrides.delete(name);
    // Kept in _managed for one more frame so it gets zeroed, then dropped.
    this._releaseNext ??= new Set();
    this._releaseNext.add(name);
    return this;
  }

  /**
   * Open the mouth by `amount` (0..1). Maps to the "aa" viseme — good enough for
   * amplitude-based lip sync: feed it your audio's normalized volume per frame.
   */
  setMouthOpen(amount) {
    return this.setExpression("aa", amount);
  }

  /**
   * Set a specific mouth shape. `vowel` is one of aa|ih|ou|ee|oh. Clears the
   * other vowel visemes so shapes don't stack.
   */
  setViseme(vowel, weight = 1) {
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

  _applyFace(delta) {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    this._updateBlink(delta);

    for (const name of this._managed) {
      let weight = 0;
      if (this._overrides.has(name)) weight = this._overrides.get(name);
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

  _updateBlink(delta) {
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
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.mixer?.stopAllAction();
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    this._envTex?.dispose?.();
    this._bgTex?.dispose?.();
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
