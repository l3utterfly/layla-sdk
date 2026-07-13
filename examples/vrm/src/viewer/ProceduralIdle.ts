import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const DEG2RAD = Math.PI / 180;

const AMBIENT_EXPRESSIONS = ["happy", "joy"] as const;
const EXPRESSION_FADE = 0.45;
const _randomExpressionDelay = () => 15 + Math.random() * 15;
const _randomExpressionDuration = () => 2.5 + Math.random() * 2.5;

export interface IdleSettings {
  enabled?: boolean;
  /** Relaxed standing pose (arms down, fingers curled). */
  basePose?: boolean;
  /** Degrees the upper arms drop below horizontal. 0 = T-pose, 90 = straight down. */
  armDrop?: number;
  /** Degrees the upper arms swing in front of the torso. */
  armForward?: number;
  /** Degrees of elbow bend. */
  elbow?: number;
  /** Resting finger curl, 0..1. */
  handCurl?: number;
  /**
   * Hold the feet at their rest positions with two-bone IK while the hips move.
   * Without this the sway slides the whole lower body and the feet skate.
   */
  plantFeet?: boolean;
  /**
   * Metres to sink the hips. With the feet planted this puts a soft bend in the
   * knees, and that bend is *load-bearing*: at rest a VRM's legs are perfectly
   * straight, so the hip sits at exactly full leg extension and any hip motion
   * at all — including sideways sway, which lengthens the hip-to-ankle span —
   * over-extends the leg and the ankle slips. The knee bend is the slack the IK
   * needs.
   *
   * 6mm is the measured minimum for zero slip with the default breath and sway
   * amounts, and lands around a 14° knee. Raise this if you raise those. Note
   * the knee travels as the *square root* of the sink, so it moves fast: 6mm of
   * sink is already ~5cm of knee. Scaled by model height.
   */
  crouch?: number;
  /** Seconds to blend the base pose in/out when a clip takes over. */
  fade?: number;
  breath?: { period?: number; amount?: number };
  sway?: { period?: number; amount?: number };
  drift?: { amount?: number };
}

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
// The thumb has its own segment names in the VRM1.0 humanoid — there is no
// `ThumbIntermediate`. three-vrm remaps VRM0's thumb bones onto these.
const THUMB_SEGMENTS = ["Metacarpal", "Proximal", "Distal"] as const;

/** Hips-to-head distance on a typical adult VRM, used to scale translations. */
const REFERENCE_TORSO = 0.7;

const _q = new THREE.Quaternion(); // output scratch for _rot
const _qs = new THREE.Quaternion(); // internal scratch for _rot
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();

/** Everything needed to hold one ankle still while the hips move around it. */
interface LegRig {
  upper: VRMHumanBoneName;
  lower: VRMHumanBoneName;
  foot: VRMHumanBoneName;
  /** Offset from the hips to the hip joint, in rig space. Constant. */
  hipOffset: THREE.Vector3;
  /** Rest directions and lengths of the thigh and shin. */
  thighRest: THREE.Vector3;
  thighLen: number;
  shinRest: THREE.Vector3;
  shinLen: number;
  /** Where the ankle must stay, in rig space. */
  target: THREE.Vector3;
  /** Which way the knee bends. */
  pole: THREE.Vector3;
}

/**
 * Ambient "aliveness" for a VRM: a relaxed base pose plus breathing, weight
 * shift and micro-drift. No animation files involved.
 *
 * Call `update(delta)` after the AnimationMixer and before `vrm.update()`. The
 * host must call `vrm.humanoid.resetNormalizedPose()` at the top of the frame —
 * without it the relative offsets below compound on any bone the active clip
 * doesn't happen to animate.
 *
 * ---
 * Why this measures everything instead of hardcoding angles:
 *
 * A normalized bone's quaternion is a *delta from its rest pose, expressed in
 * the rig's own world axes*. It is NOT a rotation in some canonical VRM frame,
 * and two things vary per model:
 *
 *   1. VRM0.0 models face -Z, VRM1.0 face +Z, so the rig is yawed 180° between
 *      them. `VRMUtils.rotateVRM0` only spins `vrm.scene` for display — the
 *      humanoid rig lives inside the scene and keeps the model's own axes. So a
 *      hardcoded rotation about Z sends the arms down on one model and up on
 *      the other. (three-vrm hits the same wall internally and patches around
 *      it in `createVRMAnimationClip`, negating X and Z when metaVersion is 0.)
 *
 *   2. Rig identity == the model's *authored* rest pose. The spec requires a
 *      T-pose, but plenty of models in the wild ship in an A-pose, so the arms
 *      can't be assumed to start out horizontal either.
 *
 * Rather than assume a frame or a rest pose, both are measured off the rig at
 * load: a basis from the bone positions, and each arm's actual rest direction.
 * Rotations are then built about the *derived* axes, and the arms are posed by
 * rotating from where they actually are onto where we want them. Handedness and
 * A-poses both fall out for free.
 */
export class ProceduralIdle {
  private readonly vrm: VRM;
  private readonly _enabled: boolean;
  private readonly _fade: number;
  private _fadeDuration: number;
  private readonly _breath: { period: number; amount: number };
  private readonly _sway: { period: number; amount: number };
  private readonly _drift: { amount: number };

  /** Model-relative axes, in rig coordinates. */
  private readonly _left = new THREE.Vector3(1, 0, 0);
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _fwd = new THREE.Vector3(0, 0, 1);
  /** Torso length relative to a typical adult, for scaling translations. */
  private _scale = 1;
  private _derived = false;

  private readonly _pose = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private readonly _legs: LegRig[] = [];
  private readonly _crouch: number;

  private _t = 0;
  private _baseWeight = 0;
  private _baseTarget = 0;

  private readonly _ambientExpressions: string[] = [];
  private _expressionTimer = _randomExpressionDelay();
  private _activeExpression: string | null = null;
  private _expressionElapsed = 0;
  private _expressionDuration = 0;

  constructor(vrm: VRM, settings: IdleSettings = {}) {
    this.vrm = vrm;
    this._enabled = settings.enabled !== false;
    this._fade = settings.fade ?? 0.45;
    this._fadeDuration = this._fade;
    this._breath = {
      period: settings.breath?.period ?? 4.2, // ~14 breaths/min
      amount: settings.breath?.amount ?? 1,
    };
    this._sway = {
      // Deliberately not a multiple of the breath period. The two cycles beat
      // against each other and the loop never becomes visible.
      period: settings.sway?.period ?? 9.7,
      amount: settings.sway?.amount ?? 1,
    };
    this._drift = { amount: settings.drift?.amount ?? 1 };
    this._crouch = settings.crouch ?? 0.006;

    const expressionManager = this.vrm.expressionManager;
    if (expressionManager) {
      for (const name of AMBIENT_EXPRESSIONS) {
        if (expressionManager.getExpression(name)) {
          this._ambientExpressions.push(name);
        }
      }
    }

    this._deriveBasis();

    if (settings.basePose !== false && this._derived) {
      this._buildBasePose(
        settings.armDrop ?? 72,
        settings.armForward ?? 7,
        settings.elbow ?? 10,
        settings.handCurl ?? 0.35,
      );
      this._baseWeight = this._baseTarget = this._pose.size > 0 ? 1 : 0;
    }

    if (settings.plantFeet !== false && this._derived) this._measureLegs();
  }

  /* ---------------------------------------------------------------- geometry */

  private _bone(name: VRMHumanBoneName) {
    return this.vrm.humanoid.getNormalizedBoneNode(name);
  }

  /**
   * Rest position of a bone in rig coordinates. Read through the rig root so the
   * result is independent of however the host has rotated or placed vrm.scene —
   * `rotateVRM0` in particular.
   */
  private _restPos(name: VRMHumanBoneName): THREE.Vector3 | null {
    const node = this._bone(name);
    if (!node) return null;
    const root = this.vrm.humanoid.normalizedHumanBonesRoot;
    return root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * Recover the model's own left/up/forward from where its bones actually sit.
   * This is what makes VRM0 vs VRM1 a non-issue: no axis is ever named, only
   * measured.
   */
  private _deriveBasis() {
    // Everything must be at rest and matrices current before measuring.
    this.vrm.humanoid.resetNormalizedPose();
    this.vrm.humanoid.normalizedHumanBonesRoot.updateWorldMatrix(true, true);

    const hips = this._restPos("hips");
    const head = this._restPos("head");
    const armL = this._restPos("leftUpperArm");
    const armR = this._restPos("rightUpperArm");

    if (!hips || !head || !armL || !armR) {
      // Incomplete humanoid. Fall back to canonical axes with VRM0's 180° yaw
      // corrected — the same thing three-vrm does internally. Breath and sway
      // still work; the base pose is skipped.
      if (this.vrm.meta?.metaVersion === "0") {
        this._left.set(-1, 0, 0);
        this._fwd.set(0, 0, -1);
      }
      console.warn(
        "ProceduralIdle: incomplete humanoid, falling back to canonical axes.",
      );
      return;
    }

    // Left is simply the axis from the right arm to the left arm.
    this._left.subVectors(armL, armR).normalize();

    // Up is hips -> head, orthogonalized against left so the basis stays square
    // on models with a tilted or laterally offset spine.
    const spine = new THREE.Vector3().subVectors(head, hips);
    this._up
      .copy(spine)
      .addScaledVector(this._left, -spine.dot(this._left))
      .normalize();

    // In any right-handed system, forward = left x up. A 180° yaw is a rotation,
    // not a reflection, so this holds however the model is oriented in its own
    // space. That is the entire trick.
    this._fwd.crossVectors(this._left, this._up).normalize();

    const torso = spine.length();
    this._scale = torso > 1e-4 ? torso / REFERENCE_TORSO : 1;

    this._derived =
      Number.isFinite(this._left.lengthSq()) &&
      this._left.lengthSq() > 0.9 &&
      this._up.lengthSq() > 0.9 &&
      this._fwd.lengthSq() > 0.9;

    if (!this._derived) {
      console.warn("ProceduralIdle: degenerate humanoid basis, base pose off.");
    }
  }

  /**
   * A rotation in model-relative terms, in degrees.
   *   pitch + tips forward
   *   yaw   + turns toward the model's left
   *   roll  + raises the model's left side
   * Built about the derived axes, so it means the same thing on every model.
   */
  private _rot(pitch: number, yaw: number, roll: number, out = _q) {
    out.identity();
    if (pitch) out.multiply(_qs.setFromAxisAngle(this._left, pitch * DEG2RAD));
    if (yaw) out.multiply(_qs.setFromAxisAngle(this._up, yaw * DEG2RAD));
    if (roll) out.multiply(_qs.setFromAxisAngle(this._fwd, roll * DEG2RAD));
    return out;
  }

  /** Rotate a bone by a model-relative delta. No-op if the model lacks the bone. */
  private _offset(
    name: VRMHumanBoneName,
    pitch: number,
    yaw: number,
    roll: number,
  ) {
    const node = this._bone(name);
    if (node) node.quaternion.multiply(this._rot(pitch, yaw, roll));
  }

  /* --------------------------------------------------------------- base pose */

  private _buildBasePose(
    armDrop: number,
    armForward: number,
    elbow: number,
    handCurl: number,
  ) {
    for (const side of ["left", "right"] as const) {
      // "outward" is the direction this arm extends away from the spine.
      const outward = this._left
        .clone()
        .multiplyScalar(side === "left" ? 1 : -1);
      this._buildArm(side, outward, armDrop, armForward, elbow);
    }
    if (handCurl > 0) this._buildFingers(handCurl);
  }

  private _buildArm(
    side: "left" | "right",
    outward: THREE.Vector3,
    armDrop: number,
    armForward: number,
    elbow: number,
  ) {
    const upperName = `${side}UpperArm` as VRMHumanBoneName;
    const lowerName = `${side}LowerArm` as VRMHumanBoneName;
    const handName = `${side}Hand` as VRMHumanBoneName;

    const upper = this._restPos(upperName);
    const lower = this._restPos(lowerName);
    if (!upper || !lower) return;

    // Where the arm actually points at rest. On a T-posed model this is roughly
    // `outward`; on an A-posed model it already points partway down. Measuring
    // it means the correction below is always exactly the right size.
    const restDir = new THREE.Vector3().subVectors(lower, upper);
    if (restDir.lengthSq() < 1e-8) return;
    restDir.normalize();

    // Where we want it: dropped below horizontal, swung slightly forward.
    const drop = armDrop * DEG2RAD;
    const targetDir = new THREE.Vector3()
      .addScaledVector(outward, Math.cos(drop))
      .addScaledVector(this._up, -Math.sin(drop))
      .addScaledVector(this._fwd, Math.sin(armForward * DEG2RAD))
      .normalize();

    // The *minimal* rotation from rest to target. Minimal matters: it adds no
    // twist of its own, so a T-posed model's palms (which the spec puts face
    // down) end up facing the thighs — which is what a relaxed arm does. An
    // A-posed model barely moves and keeps whatever twist its author intended.
    const qUpper = new THREE.Quaternion().setFromUnitVectors(restDir, targetDir);
    this._pose.set(upperName, qUpper);

    const hand = this._restPos(handName);
    if (!hand) return;

    const foreRest = new THREE.Vector3().subVectors(hand, lower);
    if (foreRest.lengthSq() < 1e-8) return;
    foreRest.normalize();

    // Bend the forearm toward the model's front, then tuck it very slightly in
    // toward the midline.
    const foreTarget = targetDir.clone();
    const hinge = new THREE.Vector3().crossVectors(targetDir, this._fwd);
    if (hinge.lengthSq() > 1e-6) {
      foreTarget.applyAxisAngle(hinge.normalize(), elbow * DEG2RAD);
    }
    foreTarget.addScaledVector(outward, -0.06).normalize();

    // The forearm's parent is the upper arm, which we just rotated. Normalized
    // bone quaternions compose down the chain, so peel the parent's contribution
    // back off to get the local value.
    const qLower = qUpper
      .clone()
      .invert()
      .multiply(new THREE.Quaternion().setFromUnitVectors(foreRest, foreTarget));
    this._pose.set(lowerName, qLower);
  }

  /**
   * The flexion hinge of a hand, derived from the hand itself.
   *
   * Fingers flex about the line running across the knuckles, so that line *is*
   * the axis — read it straight off the proximal bones. The sign (which way is
   * "toward the palm") comes from the thumb, which sits on the palm side.
   *
   * This can't be a fixed axis: on an A-posed model the fingers point down
   * rather than sideways, and a hardcoded axis would fan them out instead of
   * curling them.
   */
  private _fingerHinge(
    side: "left" | "right",
  ): { axis: THREE.Vector3; sign: number } | null {
    const hand = this._restPos(`${side}Hand` as VRMHumanBoneName);
    const index = this._restPos(`${side}IndexProximal` as VRMHumanBoneName);
    const little = this._restPos(`${side}LittleProximal` as VRMHumanBoneName);
    const midA = this._restPos(`${side}MiddleProximal` as VRMHumanBoneName);
    const midB = this._restPos(`${side}MiddleIntermediate` as VRMHumanBoneName);
    if (!hand) return null;

    // Across the knuckles.
    const axis = new THREE.Vector3();
    if (index && little) axis.subVectors(index, little);
    if (axis.lengthSq() < 1e-8) axis.copy(this._fwd); // no fingers to measure
    axis.normalize();

    // Along the fingers.
    const fingerDir = new THREE.Vector3();
    if (midA && midB) fingerDir.subVectors(midB, midA);
    else if (midA) fingerDir.subVectors(midA, hand);
    if (fingerDir.lengthSq() < 1e-8) return null;
    fingerDir.normalize();

    // Toward the palm. The thumb is the giveaway; failing that, assume the
    // spec's T-pose, where palms face down.
    const thumb =
      this._restPos(`${side}ThumbMetacarpal` as VRMHumanBoneName) ??
      this._restPos(`${side}ThumbProximal` as VRMHumanBoneName);
    const palmward = thumb
      ? new THREE.Vector3().subVectors(thumb, hand)
      : this._up.clone().multiplyScalar(-1);
    palmward.addScaledVector(fingerDir, -palmward.dot(fingerDir)); // ⟂ to the finger
    if (palmward.lengthSq() < 1e-8) return null;
    palmward.normalize();

    // Which rotation direction about `axis` carries the fingertips palmward?
    const probe = fingerDir.clone().applyAxisAngle(axis, 0.1);
    const sign = probe.dot(palmward) > 0 ? 1 : -1;

    return { axis, sign };
  }

  private _buildFingers(amount: number) {
    // A curl is relative to the hand, so it needs no parent compensation: a
    // normalized bone's quaternion composes as a rotation about the
    // *transformed* axis, so the fingers curl correctly wherever the arm ended
    // up.
    for (const side of ["left", "right"] as const) {
      const hinge = this._fingerHinge(side);
      if (!hinge) continue;

      const curl = (name: VRMHumanBoneName, deg: number) => {
        if (!this._bone(name)) return; // finger bones are optional in the spec
        this._pose.set(
          name,
          new THREE.Quaternion().setFromAxisAngle(
            hinge.axis,
            hinge.sign * deg * amount * DEG2RAD,
          ),
        );
      };

      for (const finger of FINGERS) {
        for (const segment of SEGMENTS) {
          curl(
            `${side}${finger}${segment}` as VRMHumanBoneName,
            segment === "Proximal" ? 18 : 30,
          );
        }
      }
      // The thumb opposes rather than flexes, so it only ever gets a token bend
      // on the same hinge — enough to rest it against the index finger, not
      // enough to drive it through the palm.
      for (const segment of THUMB_SEGMENTS) {
        curl(`${side}Thumb${segment}` as VRMHumanBoneName, 8);
      }
    }
  }

  /* ---------------------------------------------------------------- foot IK */

  /**
   * Cache the geometry needed to keep each ankle where it started. Measured once
   * at rest, in rig space, so it costs nothing per frame.
   */
  private _measureLegs() {
    const hips = this._restPos("hips");
    if (!hips) return;

    for (const side of ["left", "right"] as const) {
      const upper = `${side}UpperLeg` as VRMHumanBoneName;
      const lower = `${side}LowerLeg` as VRMHumanBoneName;
      const foot = `${side}Foot` as VRMHumanBoneName;

      const pUpper = this._restPos(upper);
      const pLower = this._restPos(lower);
      const pFoot = this._restPos(foot);
      if (!pUpper || !pLower || !pFoot) continue;

      const thigh = new THREE.Vector3().subVectors(pLower, pUpper);
      const shin = new THREE.Vector3().subVectors(pFoot, pLower);
      const thighLen = thigh.length();
      const shinLen = shin.length();
      if (thighLen < 1e-5 || shinLen < 1e-5) continue;

      // The knee goes forward, splayed very slightly outward.
      const outward = this._left
        .clone()
        .multiplyScalar(side === "left" ? 1 : -1);
      const pole = this._fwd.clone().addScaledVector(outward, 0.12).normalize();

      this._legs.push({
        upper,
        lower,
        foot,
        hipOffset: new THREE.Vector3().subVectors(pUpper, hips),
        thighRest: thigh.divideScalar(thighLen),
        thighLen,
        shinRest: shin.divideScalar(shinLen),
        shinLen,
        target: pFoot, // rig space; this is the whole point — it never changes
        pole,
      });
    }
  }

  /**
   * Analytic two-bone IK, run after the hips have been posed for this frame.
   *
   * The hips carry the hip joint around; we solve thigh and shin so the ankle
   * lands back on its rest position, and cancel the accumulated rotation at the
   * foot so the sole stays flat and pointing the same way. Net effect: the hips
   * sway, the legs pivot, the feet stay put.
   *
   * All of this leans on the same property the rest of the class does — a
   * normalized bone's quaternion is a delta from rest in rig-world axes, and it
   * composes down the chain. So a bone's world rotation R satisfies
   * `R · restDirection = posedDirection`, which is what makes each step below a
   * plain from-to rotation.
   */
  private _solveLegs(weight: number) {
    const hipsNode = this._bone("hips");
    if (!hipsNode || this._legs.length === 0) return;

    const hipPos = hipsNode.position; // rig space: the hips' parent is the rig root
    const hipRot = hipsNode.quaternion;

    for (const leg of this._legs) {
      // Where this hip joint ended up, given whatever the hips are doing now.
      const root = _va.copy(leg.hipOffset).applyQuaternion(hipRot).add(hipPos);

      const toTarget = _vb.subVectors(leg.target, root);
      const dist = toTarget.length();
      if (dist < 1e-5) continue;
      toTarget.divideScalar(dist);

      // Clamp into the reachable annulus. Staying just shy of full extension
      // keeps the knee out of its singularity.
      const reach = THREE.MathUtils.clamp(
        dist,
        Math.abs(leg.thighLen - leg.shinLen) + 1e-4,
        (leg.thighLen + leg.shinLen) * 0.9995,
      );

      // Bend plane: the component of the pole perpendicular to the hip->ankle
      // line. Taken from the cached pole rather than the current bend, so it
      // stays stable even when the leg is nearly straight.
      const bend = _vc
        .copy(leg.pole)
        .addScaledVector(toTarget, -leg.pole.dot(toTarget));
      if (bend.lengthSq() < 1e-8) continue;
      bend.normalize();

      // Law of cosines for the angle between the hip->ankle line and the thigh.
      const cos = THREE.MathUtils.clamp(
        (leg.thighLen * leg.thighLen + reach * reach - leg.shinLen * leg.shinLen) /
          (2 * leg.thighLen * reach),
        -1,
        1,
      );
      const hipAngle = Math.acos(cos);

      const thighDir = new THREE.Vector3()
        .addScaledVector(toTarget, Math.cos(hipAngle))
        .addScaledVector(bend, Math.sin(hipAngle));

      // Knee, then the ankle we can actually reach.
      const knee = thighDir.clone().multiplyScalar(leg.thighLen).add(root);
      const ankle = toTarget.clone().multiplyScalar(reach).add(root);
      const shinDir = ankle.sub(knee).normalize();

      // World-space deltas for each bone, then peel off the parents to get the
      // local values the rig wants.
      const rThigh = _qa.setFromUnitVectors(leg.thighRest, thighDir);
      const rShin = _qb.setFromUnitVectors(leg.shinRest, shinDir);

      // upper = hips⁻¹ · thigh
      const qUpper = _q.copy(hipRot).invert().multiply(rThigh);
      // lower = thigh⁻¹ · shin
      const qLower = _qs.copy(rThigh).invert().multiply(rShin);
      // foot = shin⁻¹, which cancels the chain and leaves the sole at rest
      const qFoot = rShin.clone().invert();

      this._bone(leg.upper)?.quaternion.slerp(qUpper, weight);
      this._bone(leg.lower)?.quaternion.slerp(qLower, weight);
      this._bone(leg.foot)?.quaternion.slerp(qFoot, weight);
    }
  }

  /* ------------------------------------------------------------------ public */

  /**
   * Fade the relaxed base pose in or out. Turn it off whenever a clip is driving
   * the body — the clip already poses the arms, and layering an absolute pose on
   * top of it would fight.
   */
  setBasePose(on: boolean, fade = this._fade) {
    this._baseTarget = on && this._pose.size > 0 ? 1 : 0;
    this._fadeDuration = Math.max(0, fade);
    return this;
  }

  /** What was measured off the rig. Log this whenever a user's model looks wrong. */
  describe() {
    return {
      derived: this._derived,
      metaVersion: this.vrm.meta?.metaVersion,
      left: this._left.toArray(),
      up: this._up.toArray(),
      forward: this._fwd.toArray(),
      torsoScale: this._scale,
      posedBones: [...this._pose.keys()],
      plantedLegs: this._legs.map((l) => l.upper),
    };
  }

  update(delta: number) {
    if (!this._enabled) return;
    this._t += delta;

    // This timer is deliberately owned by the procedural idle rather than the
    // ambient animation cycle. It keeps advancing while a neutral clip plays,
    // so facial expressions and body animations can overlap naturally.
    this._updateExpression(delta);

    // --- base pose -----------------------------------------------------------
    const step = this._fadeDuration > 0 ? delta / this._fadeDuration : 1;
    this._baseWeight += THREE.MathUtils.clamp(
      this._baseTarget - this._baseWeight,
      -step,
      step,
    );

    if (this._baseWeight > 0.001) {
      for (const [name, quat] of this._pose) {
        // The bone currently holds either its rest value (no clip playing) or
        // the clip's pose. Slerping toward the absolute base pose handles both,
        // and gives us the crossfade for free.
        this._bone(name)?.quaternion.slerp(quat, this._baseWeight);
      }
    }

    // --- breathing -----------------------------------------------------------
    // Everything below runs off accumulated time, never per-frame deltas, so
    // amplitude stays framerate-independent.
    const bw = this._breath.amount;
    if (bw > 0) {
      const inhale = Math.sin((this._t / this._breath.period) * Math.PI * 2);

      // The chest tips back about a degree on the inhale; the spine gives most
      // of it back and the neck cleans up the rest, so the head doesn't ride the
      // ribcage. Past ~2° this stops reading as breath and starts reading as a
      // wobble.
      const torso: VRMHumanBoneName = this._bone("upperChest")
        ? "upperChest"
        : "chest";
      this._offset(torso, -1.2 * inhale * bw, 0, 0);
      this._offset("spine", 0.5 * inhale * bw, 0, 0);
      this._offset("neck", 0.45 * inhale * bw, 0, 0);

      // Shoulders rise slightly. Roll flips sign per side.
      this._offset("leftShoulder", 0, 0, 0.7 * inhale * bw);
      this._offset("rightShoulder", 0, 0, -0.7 * inhale * bw);

      this._translateHips(this._up, 0.0035 * inhale * bw);
    }

    // --- weight shift --------------------------------------------------------
    // Scaled by the base-pose weight: while a clip is driving the body, the clip
    // owns the hips, and sliding them underneath it would fight the animation
    // (and the foot IK is off, so the feet would skate again).
    const sw = this._sway.amount * this._baseWeight;
    if (sw > 0) {
      const shift = Math.sin((this._t / this._sway.period) * Math.PI * 2);

      // Hips rotate and translate onto one leg while the spine counter-rotates,
      // keeping the shoulders roughly square to camera. This is the single
      // biggest contributor to "not a statue".
      this._offset("hips", 0, 1.6 * shift * sw, 0.9 * shift * sw);
      this._offset("spine", 0, -1.0 * shift * sw, -0.5 * shift * sw);

      this._translateHips(this._left, 0.008 * shift * sw);
    }

    // Sink the hips a little, which with planted feet reads as softened knees.
    if (this._crouch > 0) {
      this._translateHips(this._up, -this._crouch * this._baseWeight);
    }

    // --- micro-drift ---------------------------------------------------------
    const dw = this._drift.amount;
    if (dw > 0) {
      // Three incommensurate frequencies summed — cheap value noise. Perfect
      // stillness in the head is the tell that something is CG.
      const t = this._t;
      const nx =
        Math.sin(t * 0.31) * 0.6 +
        Math.sin(t * 0.73 + 1.3) * 0.3 +
        Math.sin(t * 1.19 + 2.7) * 0.1;
      const ny =
        Math.sin(t * 0.27 + 4.1) * 0.6 +
        Math.sin(t * 0.61 + 0.4) * 0.3 +
        Math.sin(t * 1.07 + 5.2) * 0.1;

      this._offset("head", 0.8 * nx * dw, 1.4 * ny * dw, 0);
      this._offset("neck", 0.3 * ny * dw, 0.5 * nx * dw, 0);
    }

    // --- foot IK -------------------------------------------------------------
    // Must come last: it needs the hips' final transform for this frame. Faded
    // out with the base pose so a clip's leg animation is never fought.
    if (this._baseWeight > 0.001) this._solveLegs(this._baseWeight);
  }

  private _updateExpression(delta: number) {
    const expressionManager = this.vrm.expressionManager;
    if (!expressionManager || this._ambientExpressions.length === 0) return;

    if (!this._activeExpression) {
      this._expressionTimer -= delta;
      if (this._expressionTimer > 0) return;

      this._activeExpression =
        this._ambientExpressions[
          Math.floor(Math.random() * this._ambientExpressions.length)
        ];
      this._expressionElapsed = 0;
      this._expressionDuration = _randomExpressionDuration();
    }

    this._expressionElapsed += delta;
    const fadeIn = THREE.MathUtils.clamp(
      this._expressionElapsed / EXPRESSION_FADE,
      0,
      0.5,
    );
    const fadeOut = THREE.MathUtils.clamp(
      (this._expressionDuration - this._expressionElapsed) / EXPRESSION_FADE,
      0,
      0.5,
    );
    expressionManager.setValue(
      this._activeExpression,
      Math.min(fadeIn, fadeOut),
    );

    if (this._expressionElapsed >= this._expressionDuration) {
      expressionManager.setValue(this._activeExpression, 0);
      this._activeExpression = null;
      this._expressionTimer = _randomExpressionDelay();
    }
  }

  /** Nudge the hips along a model-relative axis, scaled to the model's height. */
  private _translateHips(axis: THREE.Vector3, meters: number) {
    const hips = this._bone("hips");
    if (hips) hips.position.addScaledVector(axis, meters * this._scale);
  }
}
