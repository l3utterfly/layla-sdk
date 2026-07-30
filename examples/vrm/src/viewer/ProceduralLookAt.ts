import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface LookAtSettings {
  enabled?: boolean;
  /** Seconds to blend the whole look in when a target is set and out on clear(). */
  fade?: number;
  /**
   * Time constant, in seconds, for the head easing toward a moving target. Lower
   * is snappier, higher is lazier. This is what stops the head from teleporting
   * when the point jumps across the screen.
   */
  smoothing?: number;
  /** Largest left/right turn, in degrees, measured from facing forward. */
  maxYaw?: number;
  /** Largest up/down tilt, in degrees, measured from facing forward. */
  maxPitch?: number;
  /**
   * How the yaw is shared down the chain. The three fractions are relative and
   * get normalized, so { chest: 1, neck: 2, head: 3 } is the same as the default.
   * Pitch is shared between the neck and head only (the chest never pitches, so
   * the avatar tips its head rather than leaning its whole torso).
   */
  distribution?: { chest?: number; neck?: number; head?: number };
  /** Also swivel the eyes onto the point using the VRM look-at system. */
  eyes?: boolean;
}

/** Where the aim point sits along the camera ray. See `_worldTarget`. */
const _ray = new THREE.Vector3();
const _cameraPos = new THREE.Vector3();
const _worldTarget = new THREE.Vector3();
const _targetRig = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dirRig = new THREE.Vector3();
const _eyePoint = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();

/**
 * Turns a VRM avatar to look at a point given in 2D screen space.
 *
 * A screen point is a ray in the world, not a single position, so this casts
 * that ray from the camera and picks the point on it that sits at the avatar's
 * own depth — the natural "you pointed *there*, so look *there*" reading. The
 * head-to-point direction is then split into a yaw and a pitch and distributed
 * down the chest/neck/head, with the eyes optionally swivelled on top via the
 * VRM look-at system.
 *
 * Call `update(delta)` after the AnimationMixer and the ProceduralIdle, and
 * before `vrm.update()`. Like ProceduralIdle it layers *relative* offsets on top
 * of whatever pose the bones already hold, so the host must call
 * `vrm.humanoid.resetNormalizedPose()` at the top of the frame. Layering after
 * the idle means the idle's micro-drift still shows through as the head aims.
 *
 * ---
 * VRM0 vs VRM1, A-pose vs T-pose: identical problem to ProceduralIdle, identical
 * fix. A normalized bone's rotation is a delta from rest expressed in the rig's
 * own axes, and those axes are yawed 180° between VRM0 and VRM1. So nothing here
 * names an axis — the model's left/up/forward are *measured* off the rig at load,
 * and every rotation is built about those derived axes. Handedness falls out for
 * free. (See ProceduralIdle for the long version of why this is necessary.)
 */
export class ProceduralLookAt {
  private readonly vrm: VRM;
  private readonly camera: THREE.Camera;
  private readonly _enabled: boolean;
  private readonly _fade: number;
  private readonly _smoothing: number;
  private readonly _maxYaw: number;
  private readonly _maxPitch: number;
  private readonly _eyes: boolean;
  private readonly _yawShare: { chest: number; neck: number; head: number };
  private readonly _pitchShare: { neck: number; head: number };

  /** Model-relative axes in rig coordinates, measured at load. */
  private readonly _left = new THREE.Vector3(1, 0, 0);
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _fwd = new THREE.Vector3(0, 0, 1);
  /** Head rest position in rig coordinates — the pivot we aim from. */
  private readonly _headRest = new THREE.Vector3();
  private _derived = false;

  private readonly _chestBone: VRMHumanBoneName;

  /** The active point in normalized device coordinates (x,y ∈ [-1,1], y up). */
  private _ndc: { x: number; y: number } | null = null;
  /** Blend of the whole behaviour, 0..1. */
  private _weight = 0;
  private _weightTarget = 0;
  /** Smoothed aim, in radians. Eased toward the target every frame. */
  private _yaw = 0;
  private _pitch = 0;

  /** Off-graph node fed to vrm.lookAt so the eyes track the point too. */
  private readonly _eyeTarget = new THREE.Object3D();
  private _drivingEyes = false;

  constructor(vrm: VRM, camera: THREE.Camera, settings: LookAtSettings = {}) {
    this.vrm = vrm;
    this.camera = camera;
    this._enabled = settings.enabled !== false;
    this._fade = Math.max(0, settings.fade ?? 0.35);
    this._smoothing = Math.max(0, settings.smoothing ?? 0.12);
    this._maxYaw = settings.maxYaw ?? 55;
    this._maxPitch = settings.maxPitch ?? 32;
    this._eyes = settings.eyes !== false;

    const d = settings.distribution ?? {};
    const chest = d.chest ?? 0.2;
    const neck = d.neck ?? 0.35;
    const head = d.head ?? 0.45;
    const yawSum = chest + neck + head || 1;
    this._yawShare = {
      chest: chest / yawSum,
      neck: neck / yawSum,
      head: head / yawSum,
    };
    // The chest is deliberately excluded from pitch — see `distribution` above.
    const pitchSum = neck + head || 1;
    this._pitchShare = { neck: neck / pitchSum, head: head / pitchSum };

    this._chestBone = this._bone("upperChest")
      ? "upperChest"
      : this._bone("chest")
        ? "chest"
        : "spine";

    this._deriveBasis();
  }

  /* ---------------------------------------------------------------- geometry */

  private _bone(name: VRMHumanBoneName) {
    return this.vrm.humanoid.getNormalizedBoneNode(name);
  }

  private _restPos(name: VRMHumanBoneName): THREE.Vector3 | null {
    const node = this._bone(name);
    if (!node) return null;
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    return root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  }

  /** Recover the model's own left/up/forward from where its bones sit at rest. */
  private _deriveBasis() {
    this.vrm.humanoid.resetNormalizedPose();
    this.vrm.humanoid.normalizedHumanBonesRoot.updateWorldMatrix(true, true);

    const hips = this._restPos("hips");
    const head = this._restPos("head");
    const armL = this._restPos("leftUpperArm");
    const armR = this._restPos("rightUpperArm");

    if (!hips || !head || !armL || !armR) {
      // Incomplete humanoid: fall back to canonical axes with VRM0's 180° yaw
      // corrected, exactly as ProceduralIdle does. Aim still works, just without
      // the per-model guarantee.
      if (this.vrm.meta?.metaVersion === "0") {
        this._left.set(-1, 0, 0);
        this._fwd.set(0, 0, -1);
      }
      if (head) this._headRest.copy(head);
      console.warn(
        "ProceduralLookAt: incomplete humanoid, falling back to canonical axes.",
      );
      return;
    }

    this._left.subVectors(armL, armR).normalize();
    const spine = new THREE.Vector3().subVectors(head, hips);
    this._up
      .copy(spine)
      .addScaledVector(this._left, -spine.dot(this._left))
      .normalize();
    // forward = left × up holds under any yaw (a rotation, not a reflection).
    this._fwd.crossVectors(this._left, this._up).normalize();
    this._headRest.copy(head);

    this._derived =
      this._left.lengthSq() > 0.9 &&
      this._up.lengthSq() > 0.9 &&
      this._fwd.lengthSq() > 0.9;

    if (!this._derived) {
      console.warn("ProceduralLookAt: degenerate humanoid basis.");
    }
  }

  /* ------------------------------------------------------------------ public */

  /**
   * Look at a point given in **screen pixels**, origin at the top-left, as they
   * arrive from a pointer event relative to the render canvas. `width`/`height`
   * are the canvas's CSS size. This is the "2D screen space" entry point.
   */
  lookAtScreen(x: number, y: number, width: number, height: number) {
    if (width <= 0 || height <= 0) return this;
    // Pixels (y down) → normalized device coordinates (y up).
    return this.lookAtNdc((x / width) * 2 - 1, -((y / height) * 2 - 1));
  }

  /** Look at a point in normalized device coordinates (x,y ∈ [-1,1], y up). */
  lookAtNdc(x: number, y: number) {
    if (!this._enabled) return this;
    this._ndc = { x, y };
    this._weightTarget = 1;
    return this;
  }

  /** Look at an explicit world-space position instead of a screen point. */
  lookAtWorld(target: THREE.Vector3) {
    if (!this._enabled) return this;
    _worldTarget.copy(target);
    this._ndc = null;
    this._weightTarget = 1;
    this._aimAt(_worldTarget);
    return this;
  }

  /** Release the look; the head eases back to neutral and the eyes let go. */
  clear() {
    this._weightTarget = 0;
    this._ndc = null;
    return this;
  }

  get isLooking() {
    return this._weightTarget > 0;
  }

  update(delta: number) {
    if (!this._enabled) return;

    // --- blend weight --------------------------------------------------------
    const step = this._fade > 0 ? delta / this._fade : 1;
    this._weight += THREE.MathUtils.clamp(
      this._weightTarget - this._weight,
      -step,
      step,
    );

    // Fully released: let the eyes go (once) and skip the rest.
    if (this._weight <= 0.001 && this._weightTarget === 0) {
      this._weight = 0;
      this._releaseEyes();
      // Ease the stored aim back to centre so the next look starts from neutral.
      this._yaw = this._pitch = 0;
      return;
    }

    // --- resolve the target every frame --------------------------------------
    // Re-cast the ray each frame so a moving camera (or a moving point) is
    // tracked. A world target set via lookAtWorld() is used as-is.
    if (this._ndc) {
      this._screenToWorld(this._ndc.x, this._ndc.y, _worldTarget);
      this._aimAt(_worldTarget);
    }

    // --- ease the head toward the aim ----------------------------------------
    // Exponential smoothing, framerate-independent. `_aimAt` wrote the raw
    // desired yaw/pitch into the target-space temporaries below.
    const a =
      this._smoothing > 0 ? 1 - Math.exp(-delta / this._smoothing) : 1;
    this._yaw += (this._desiredYaw - this._yaw) * a;
    this._pitch += (this._desiredPitch - this._pitch) * a;

    // --- distribute the rotation down the chain ------------------------------
    const yawDeg = this._yaw * RAD2DEG * this._weight;
    const pitchDeg = this._pitch * RAD2DEG * this._weight;

    this._offset(this._chestBone, 0, yawDeg * this._yawShare.chest, 0);
    this._offset(
      "neck",
      pitchDeg * this._pitchShare.neck,
      yawDeg * this._yawShare.neck,
      0,
    );
    this._offset(
      "head",
      pitchDeg * this._pitchShare.head,
      yawDeg * this._yawShare.head,
      0,
    );

    // --- eyes ----------------------------------------------------------------
    if (this._eyes) this._driveEyes();
  }

  /* --------------------------------------------------------------- internals */

  /** Raw desired aim for this frame, written by `_aimAt`, read by the smoother. */
  private _desiredYaw = 0;
  private _desiredPitch = 0;

  /**
   * Turn a screen point into a world position at the avatar's depth. The ray
   * from the camera through the point is intersected with the plane that passes
   * through the head and faces the camera, so pointing at the head looks the
   * avatar straight down the barrel and pointing to the edge looks it aside.
   */
  private _screenToWorld(ndcX: number, ndcY: number, out: THREE.Vector3) {
    this.camera.getWorldPosition(_cameraPos);
    // Unproject a point on the far side of the near plane to get a ray direction.
    _ray.set(ndcX, ndcY, 0.5).unproject(this.camera).sub(_cameraPos).normalize();

    // Head position in world space, and its distance from the camera.
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    out.copy(this._headRest);
    root.localToWorld(out); // head world position (reused as scratch)
    const depth = out.distanceTo(_cameraPos);

    // Point on the ray at the head's depth.
    out.copy(_cameraPos).addScaledVector(_ray, depth);
  }

  /** Compute the desired yaw/pitch to a world point, in the model's own frame. */
  private _aimAt(worldTarget: THREE.Vector3) {
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    _targetRig.copy(worldTarget);
    root.worldToLocal(_targetRig);
    _dir.subVectors(_targetRig, this._headRest);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();

    // Decompose the direction onto the derived axes.
    const f = _dir.dot(this._fwd); // toward the face
    const l = _dir.dot(this._left); // toward the model's left
    const u = _dir.dot(this._up); // upward
    const horiz = Math.hypot(f, l);

    // yaw+ turns toward the model's left; pitch+ tips the chin down. So looking
    // up (u>0) is a negative pitch. Matches the sign convention in `_rot`.
    const yaw = Math.atan2(l, f);
    const pitch = -Math.atan2(u, horiz);

    // Clamp so the head never wrenches past a plausible range.
    const maxYaw = this._maxYaw * DEG2RAD;
    const maxPitch = this._maxPitch * DEG2RAD;
    this._desiredYaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
    this._desiredPitch = THREE.MathUtils.clamp(pitch, -maxPitch, maxPitch);
  }

  /**
   * A model-relative rotation about the derived axes, in degrees. Same
   * convention as ProceduralIdle._rot: pitch+ forward, yaw+ toward the left.
   */
  private _rot(pitch: number, yaw: number, roll: number) {
    _q.identity();
    if (pitch) _q.multiply(_qs.setFromAxisAngle(this._left, pitch * DEG2RAD));
    if (yaw) _q.multiply(_qs.setFromAxisAngle(this._up, yaw * DEG2RAD));
    if (roll) _q.multiply(_qs.setFromAxisAngle(this._fwd, roll * DEG2RAD));
    return _q;
  }

  private _offset(
    name: VRMHumanBoneName,
    pitch: number,
    yaw: number,
    roll: number,
  ) {
    if (!pitch && !yaw && !roll) return;
    const node = this._bone(name);
    if (node) node.quaternion.multiply(this._rot(pitch, yaw, roll));
  }

  /**
   * Point the VRM eyes at the same spot. The eye target sits along the smoothed,
   * weight-scaled aim direction, so at weight 0 the gaze is straight ahead and
   * eases onto the point as the head does — no snap on fade-in.
   */
  private _driveEyes() {
    const lookAt = this.vrm.lookAt;
    if (!lookAt) return;

    // Rebuild a forward rotated by the current (weighted) aim, in rig space.
    _dirRig
      .copy(this._fwd)
      .applyQuaternion(
        this._rot(this._pitch * RAD2DEG * this._weight, this._yaw * RAD2DEG * this._weight, 0),
      );

    // A point a metre or two down that direction from the head, in world space.
    _eyePoint.copy(this._headRest).addScaledVector(_dirRig, 2);
    this.vrm.humanoid.normalizedHumanBonesRoot.localToWorld(_eyePoint);

    this._eyeTarget.position.copy(_eyePoint);
    this._eyeTarget.updateMatrixWorld();
    lookAt.target = this._eyeTarget;
    this._drivingEyes = true;
  }

  private _releaseEyes() {
    if (!this._drivingEyes) return;
    if (this.vrm.lookAt && this.vrm.lookAt.target === this._eyeTarget) {
      this.vrm.lookAt.target = null;
    }
    this._drivingEyes = false;
  }

  /** What was measured off the rig. Log this if a model looks wrong. */
  describe() {
    return {
      derived: this._derived,
      metaVersion: this.vrm.meta?.metaVersion,
      left: this._left.toArray(),
      up: this._up.toArray(),
      forward: this._fwd.toArray(),
      headRest: this._headRest.toArray(),
      chestBone: this._chestBone,
    };
  }
}
