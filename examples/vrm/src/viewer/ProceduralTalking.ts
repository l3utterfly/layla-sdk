import type { VRM } from "@pixiv/three-vrm";

const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;
type Viseme = (typeof VISEMES)[number];
type VisemeWeights = Record<Viseme, number>;

const _emptyWeights = (): VisemeWeights => ({
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
});

const _randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

export interface TalkingSettings {
  enabled?: boolean;
  /** Overall mouth movement, where 1 is the default and 0 keeps it closed. */
  intensity?: number;
  /** Syllable rate multiplier. Values above 1 move the mouth faster. */
  speed?: number;
}

/**
 * Lightweight, audio-independent talking motion for a VRM avatar.
 *
 * Rather than trying to lip-sync, this cross-fades between the vowel expressions
 * the model provides, with varied syllable lengths and occasional word breaks.
 * Call `update(delta)` after the AnimationMixer and before `vrm.update()`.
 */
export class ProceduralTalking {
  private readonly vrm: VRM;
  private readonly _enabled: boolean;
  private readonly _intensity: number;
  private readonly _speed: number;
  private readonly _visemes: Viseme[] = [];

  private _talking = false;
  private _active = false;
  private _lastViseme: Viseme | null = null;
  private _elapsed = 0;
  private _duration = 0.12;
  private _from = _emptyWeights();
  private _current = _emptyWeights();
  private _target = _emptyWeights();

  constructor(vrm: VRM, settings: TalkingSettings = {}) {
    this.vrm = vrm;
    this._enabled = settings.enabled !== false;
    this._intensity = Math.max(0, settings.intensity ?? 1);
    this._speed = Math.max(0.1, settings.speed ?? 1);

    const expressionManager = vrm.expressionManager;
    if (expressionManager) {
      for (const viseme of VISEMES) {
        if (expressionManager.getExpression(viseme)) this._visemes.push(viseme);
      }
    }
  }

  /** Begin generating mouth movement. Safe to call repeatedly. */
  start() {
    if (!this._enabled || this._visemes.length === 0 || this._talking) {
      return this;
    }

    this._talking = true;
    this._active = true;
    this._nextSegment(false);
    return this;
  }

  /** Fade the mouth closed and stop generating new syllables. */
  stop() {
    if (!this._talking && !this._active) return this;

    this._talking = false;
    this._beginSegment(_emptyWeights(), 0.12 / this._speed);
    return this;
  }

  get isTalking() {
    return this._talking;
  }

  update(delta: number) {
    const expressionManager = this.vrm.expressionManager;
    if (!this._active || !expressionManager) return;

    let remaining = Math.max(delta, 0);
    do {
      const step = Math.min(remaining, this._duration - this._elapsed);
      this._elapsed += step;
      remaining -= step;

      const progress = Math.min(this._elapsed / this._duration, 1);
      const eased = progress * progress * (3 - 2 * progress);
      for (const viseme of this._visemes) {
        this._current[viseme] =
          this._from[viseme] +
          (this._target[viseme] - this._from[viseme]) * eased;
      }

      if (progress < 1) break;

      if (!this._talking) {
        this._active = false;
        this._lastViseme = null;
        break;
      }
      this._nextSegment();
    } while (remaining > 0);

    // Only touch expressions that exist on this model. ViewerEngine applies
    // manual expression overrides after this update, so explicit controls win.
    for (const viseme of this._visemes) {
      expressionManager.setValue(viseme, this._current[viseme]);
    }
  }

  private _nextSegment(allowPause = true) {
    // Short closures separate words and keep the motion from looking like a
    // continuous sine wave. Do not pause on the first syllable after start().
    if (allowPause && Math.random() < 0.18) {
      this._beginSegment(
        _emptyWeights(),
        _randomBetween(0.09, 0.22) / this._speed,
      );
      return;
    }

    const candidates =
      this._visemes.length > 1
        ? this._visemes.filter((viseme) => viseme !== this._lastViseme)
        : this._visemes;
    const viseme = candidates[Math.floor(Math.random() * candidates.length)];
    const target = _emptyWeights();
    target[viseme] =
      Math.min(1, _randomBetween(0.28, 0.72) * this._intensity);
    this._lastViseme = viseme;
    this._beginSegment(
      target,
      _randomBetween(0.09, 0.17) / this._speed,
    );
  }

  private _beginSegment(target: VisemeWeights, duration: number) {
    this._from = { ...this._current };
    this._target = target;
    this._elapsed = 0;
    this._duration = Math.max(duration, 0.001);
    this._active = true;
  }
}
