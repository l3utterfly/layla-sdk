/* ====================================================================== *
 *  userModel.ts
 *  --------------------------------------------------------------------- *
 *  An interpretable, online "taste model" for the swipe deck.
 *
 *  Idea in one paragraph:
 *    - There is a big, HIDDEN space of trait axes (lifestyle + appearance)
 *      and a closed vocabulary of interests.
 *    - Each swipe is one training example for an online logistic regression
 *      (AdaGrad steps). The features are the axis values we *requested* in
 *      the prompt plus the interests the character actually had.
 *    - To build the next profile we sample a concrete target per axis
 *      (preferred position + exploration spread), keep the few strongest,
 *      and turn them into a short, plain-language prompt. A weak local LLM
 *      never sees the axes or any numbers.
 *    - Exploration is deliberately long-lived: temperature floors high,
 *      weights are capped, spread has a floor, and wildcards never stop.
 *      We are NOT trying to converge on one "best" character.
 *
 *  The LLM itself is never asked to produce numbers — only a JSON profile.
 * ====================================================================== */

/* ---------------------------------------------------------------------- */
/*  Axis catalog (HIDDEN from the user and from the LLM)                   */
/* ---------------------------------------------------------------------- */

export type AxisKind = "lifestyle" | "appearance";

export interface Axis {
  id: string;
  /** phrase used when the sampled value is negative (toward -1) */
  neg: string;
  /** phrase used when the sampled value is positive (toward +1) */
  pos: string;
  kind: AxisKind;
}

/** Phrases are written so they read naturally after "very" / "a bit". */
export const AXES: Axis[] = [
  // —— lifestyle / temperament (drive the bio) ——
  { id: "active_sedentary",     neg: "outdoorsy",        pos: "indoorsy",         kind: "lifestyle" },
  { id: "extro_intro",          neg: "outgoing",         pos: "reserved",         kind: "lifestyle" },
  { id: "spontaneous_planner",  neg: "spontaneous",      pos: "organized",        kind: "lifestyle" },
  { id: "adventurous_routine",  neg: "adventurous",      pos: "routine-loving",   kind: "lifestyle" },
  { id: "cerebral_practical",   neg: "intellectual",     pos: "down-to-earth",    kind: "lifestyle" },
  { id: "serious_playful",      neg: "serious",          pos: "playful",          kind: "lifestyle" },
  { id: "driven_easygoing",     neg: "ambitious",        pos: "easygoing",        kind: "lifestyle" },
  { id: "expressive_reserved",  neg: "emotionally open", pos: "stoic",            kind: "lifestyle" },
  { id: "traditional_alt",      neg: "traditional",      pos: "unconventional",   kind: "lifestyle" },
  { id: "warm_independent",     neg: "nurturing",        pos: "independent",      kind: "lifestyle" },
  { id: "intense_mellow",       neg: "high-energy",      pos: "mellow",           kind: "lifestyle" },
  { id: "orderly_chaotic",      neg: "tidy",             pos: "free-spirited",    kind: "lifestyle" },
  { id: "refined_rugged",       neg: "polished",         pos: "rugged",           kind: "lifestyle" },
  { id: "mainstream_niche",     neg: "mainstream",       pos: "niche",            kind: "lifestyle" },
  { id: "wholesome_edgy",       neg: "wholesome",        pos: "edgy",             kind: "lifestyle" },
  // —— appearance (drive the image; the LLM folds them into imagePrompt) ——
  { id: "cute_sultry",          neg: "cute",             pos: "sultry",           kind: "appearance" },
  { id: "athletic_lean",        neg: "toned",            pos: "slim",             kind: "appearance" },
  { id: "soft_sharp",           neg: "soft-featured",    pos: "sharp-featured",   kind: "appearance" },
  { id: "groomed_natural",      neg: "well-groomed",     pos: "natural-looking",  kind: "appearance" },
  { id: "vivid_understated",    neg: "boldly stylish",   pos: "understated",      kind: "appearance" },
  { id: "youthful_mature",      neg: "youthful",         pos: "mature",           kind: "appearance" },
];

const AXIS_BY_ID: Record<string, Axis> = Object.fromEntries(AXES.map((a) => [a.id, a]));

/* ---------------------------------------------------------------------- */
/*  Interest vocabulary (CLOSED — the LLM must pick from this list)        */
/* ---------------------------------------------------------------------- */

export const VOCAB: string[] = [
  // food
  "sushi", "ramen", "tacos", "vegan food", "spicy food", "fine dining", "baking",
  // screen
  "horror films", "sci-fi", "anime", "rom-coms", "documentaries", "indie films",
  // music
  "indie music", "hip-hop", "techno", "classical music", "jazz", "lo-fi",
  // doing
  "hiking", "gaming", "lifting weights", "yoga", "rock climbing", "photography",
  "painting", "reading", "gardening", "board games", "traveling", "surfing",
  "thrifting", "dancing",
  // pets + nightlife
  "dogs", "cats", "clubbing", "dive bars", "concerts", "museums", "quiet nights in",
];

/* ---------------------------------------------------------------------- */
/*  Tunable knobs                                                         */
/* ---------------------------------------------------------------------- */

export const CFG = {
  // learning ---------------------------------------------------------------
  lrLike: 0.20, // a right-swipe is the rarer, stronger signal …
  lrPass: 0.07, // … so it moves weights ~3x more than a pass
  eps: 1e-6,
  forget: 0.006, // gentle global decay per swipe → tracks mood, never fossilizes
  wClamp: 1.2, // cap |w| so a learned axis can't pin the prompt to an extreme

  // weight → preferred position -------------------------------------------
  k: 0.9, // saturation: mu = tanh(k * w)
  muCap: 0.65, // even a maxed-out axis only leans to ±0.65, never ±1 (keeps variety)

  // sampling spread (the engine of variance) ------------------------------
  sBase: 0.34, // floor: a known axis still samples a *range*, never a fixed value
  sUnsure: 0.85, // extra spread when we have little evidence: sUnsure / sqrt(G+1)
  sTemp: 0.55, // how much global temperature widens the spread

  // temperature: starts hot, eases to a HIGH FLOOR, never converges -------
  tempStart: 1.0,
  tempFloor: 0.55,
  tempEase: 110, // swipes over which it relaxes toward the floor

  // prompt assembly --------------------------------------------------------
  tau: 0.34, // a sampled |value| must clear this to be worth mentioning
  maxAxes: 4, // K: never put more than this many traits in one prompt

  // wildcards: permanent, not front-loaded --------------------------------
  wildcardEvery: 5, // roughly every Nth profile is a deliberate curveball
  wildBoost: 1.8, // how much wider a wildcard samples
};

/* ---------------------------------------------------------------------- */
/*  Model state                                                           */
/* ---------------------------------------------------------------------- */

export interface UserModel {
  /** logistic weight per axis (signed preference) */
  w: Record<string, number>;
  /** AdaGrad squared-gradient accumulator per axis (≈ evidence) */
  G: Record<string, number>;
  /** logistic weight per interest */
  iw: Record<string, number>;
  /** AdaGrad accumulator per interest */
  iG: Record<string, number>;
  bias: number;
  biasG: number;
  /** swipes recorded (drives temperature + readiness) */
  swipes: number;
  /** profiles generated (drives wildcard cadence) */
  generated: number;
}

export function createUserModel(): UserModel {
  return { w: {}, G: {}, iw: {}, iG: {}, bias: 0, biasG: 0, swipes: 0, generated: 0 };
}

/* ---------------------------------------------------------------------- */
/*  Small math helpers (exported — the deck reuses them for dummy data)    */
/* ---------------------------------------------------------------------- */

export const pick = <X>(arr: X[]): X => arr[Math.floor(Math.random() * arr.length)];

export const sample = <X>(arr: X[], n: number): X[] => {
  const copy = [...arr];
  const out: X[] = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
};

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** standard normal via Box–Muller */
function gaussian(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** softmax sample without replacement; uniform when all scores are equal */
function weightedPick(items: string[], score: (s: string) => number, temp: number, n: number): string[] {
  const pool = [...items];
  const out: string[] = [];
  const tau = Math.max(0.15, temp);
  while (out.length < n && pool.length) {
    const exps = pool.map((it) => Math.exp(score(it) / tau));
    const total = exps.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= exps[idx];
      if (r <= 0) break;
    }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/*  Learning: one swipe → one AdaGrad logistic-regression step            */
/* ---------------------------------------------------------------------- */

/** the +1 / -1 / 0 interest features for a given character */
function interestFeatures(c: { likes: string[]; dislikes: string[] }): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of VOCAB) {
    if (c.likes.includes(v)) m.set(v, 1);
    else if (c.dislikes.includes(v)) m.set(v, -1);
  }
  return m;
}

/**
 * Record a swipe.
 *  - `features` are the axis values we REQUESTED for this profile
 *    (signed; only the axes we actually mentioned are present).
 *  - interest features are read from the character that came back.
 */
export function recordSwipe(
  m: UserModel,
  features: Record<string, number>,
  character: { likes: string[]; dislikes: string[] },
  liked: boolean,
): void {
  const y = liked ? 1 : 0;
  const lr = liked ? CFG.lrLike : CFG.lrPass;

  const axisX = Object.entries(features).filter(([, x]) => x !== 0);
  const interX = [...interestFeatures(character).entries()];

  // forward pass: p = sigmoid(w·x + bias)
  let z = m.bias;
  for (const [id, x] of axisX) z += (m.w[id] ?? 0) * x;
  for (const [it, x] of interX) z += (m.iw[it] ?? 0) * x;
  const err = y - sigmoid(z);

  // AdaGrad update for each touched coordinate
  for (const [id, x] of axisX) {
    const g = err * x;
    m.G[id] = (m.G[id] ?? 0) + g * g;
    const step = (lr / (Math.sqrt(m.G[id]) + CFG.eps)) * g;
    m.w[id] = clamp((m.w[id] ?? 0) + step, -CFG.wClamp, CFG.wClamp);
  }
  for (const [it, x] of interX) {
    const g = err * x;
    m.iG[it] = (m.iG[it] ?? 0) + g * g;
    const step = (lr / (Math.sqrt(m.iG[it]) + CFG.eps)) * g;
    m.iw[it] = clamp((m.iw[it] ?? 0) + step, -CFG.wClamp, CFG.wClamp);
  }
  const gb = err;
  m.biasG += gb * gb;
  m.bias += (lr / (Math.sqrt(m.biasG) + CFG.eps)) * gb;

  // gentle global forgetting → recency / drift, and untouched axes relax to 0
  const keep = 1 - CFG.forget;
  for (const id of Object.keys(m.w)) m.w[id] *= keep;
  for (const it of Object.keys(m.iw)) m.iw[it] *= keep;
  m.bias *= keep;

  m.swipes += 1;
}

/* ---------------------------------------------------------------------- */
/*  Readiness (for the hidden-axis "getting to know you" meter)           */
/* ---------------------------------------------------------------------- */

/** 0..1, saturating, never reaches 1 — we're never "done". */
export function readiness(m: UserModel): number {
  return m.swipes / (m.swipes + 25);
}

/* ---------------------------------------------------------------------- */
/*  Sampling + prompt building                                            */
/* ---------------------------------------------------------------------- */

export interface GenRequest {
  systemPrompt: string;
  userPrompt: string;
  /** axis values we requested → used as training features on the next swipe */
  features: Record<string, number>;
  suggestedLikes: string[];
  suggestedDislikes: string[];
  isWildcard: boolean;
}

function temperature(swipes: number): number {
  return CFG.tempFloor + (CFG.tempStart - CFG.tempFloor) * Math.exp(-swipes / CFG.tempEase);
}

function mostConfidentAxis(m: UserModel): string | null {
  let best: string | null = null;
  let bestMag = 0.12; // ignore essentially-flat axes
  for (const a of AXES) {
    const mag = Math.abs(m.w[a.id] ?? 0);
    if (mag > bestMag) {
      bestMag = mag;
      best = a.id;
    }
  }
  return best;
}

/** sampled value → natural-language fragment (the only place axes are named) */
function phraseFor(ax: Axis, v: number): string {
  const pole = v < 0 ? ax.neg : ax.pos;
  const mag = Math.abs(v);
  if (mag >= 0.66) return `very ${pole}`;
  if (mag >= 0.46) return pole;
  return `a bit ${pole}`;
}

function suggestInterests(m: UserModel, temp: number, wild: boolean): { likes: string[]; dislikes: string[] } {
  const t = temp * (wild ? 1.5 : 1);
  const nLikes = 1 + (Math.random() < 0.55 ? 1 : 0); // 1–2
  const likes = weightedPick(VOCAB, (it) => m.iw[it] ?? 0, t, nLikes);

  let dislikes: string[] = [];
  if (Math.random() < 0.4) {
    dislikes = weightedPick(
      VOCAB.filter((v) => !likes.includes(v)),
      (it) => -(m.iw[it] ?? 0), // dislike side
      t,
      1,
    );
  }
  return { likes, dislikes };
}

/**
 * Build the next generation request from the current model state.
 * NOTE: mutates `m.generated` (wildcard cadence). It does NOT touch weights.
 */
export function nextRequest(m: UserModel): GenRequest {
  const temp = temperature(m.swipes);
  const isWildcard = m.generated % CFG.wildcardEvery === CFG.wildcardEvery - 1;
  m.generated += 1;

  // 1) sample a concrete target per axis
  const targets: Record<string, number> = {};
  for (const a of AXES) {
    const mu = clamp(Math.tanh(CFG.k * (m.w[a.id] ?? 0)), -CFG.muCap, CFG.muCap);
    let s = CFG.sBase + CFG.sUnsure / Math.sqrt((m.G[a.id] ?? 0) + 1) + CFG.sTemp * temp;
    if (isWildcard) s *= CFG.wildBoost;
    targets[a.id] = clamp(gaussian(mu, s), -1, 1);
  }

  // a wildcard also flips our most-confident axis, to show a new angle
  let forced: string | null = null;
  if (isWildcard) {
    forced = mostConfidentAxis(m);
    if (forced) {
      const dir = (m.w[forced] ?? 0) >= 0 ? -1 : 1;
      targets[forced] = dir * (0.7 + Math.random() * 0.3);
    }
  }

  // 2) keep only the few strongest axes (short prompt + clean credit)
  let chosen = AXES.map((a) => a.id)
    .filter((id) => Math.abs(targets[id]) >= CFG.tau)
    .sort((a, b) => Math.abs(targets[b]) - Math.abs(targets[a]))
    .slice(0, CFG.maxAxes);
  if (forced && !chosen.includes(forced)) chosen = [forced, ...chosen].slice(0, CFG.maxAxes);

  const features: Record<string, number> = {};
  for (const id of chosen) features[id] = targets[id];

  // 3) suggest a couple of interests from the closed vocabulary
  const { likes, dislikes } = suggestInterests(m, temp, isWildcard);

  // 4) assemble a short, local-LLM-friendly prompt
  const lines: string[] = ["New character."];
  if (chosen.length) {
    lines.push("Traits: " + chosen.map((id) => phraseFor(AXIS_BY_ID[id], targets[id])).join(", ") + ".");
  }
  if (likes.length) lines.push("Maybe likes: " + likes.join(", ") + ".");
  if (dislikes.length) lines.push("Maybe dislikes: " + dislikes.join(", ") + ".");
  lines.push(isWildcard ? "Make them unexpected and distinctive. JSON only." : "Otherwise be creative. JSON only.");

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: lines.join("\n"),
    features,
    suggestedLikes: likes,
    suggestedDislikes: dislikes,
    isWildcard,
  };
}

/* ---------------------------------------------------------------------- */
/*  The fixed system prompt                                               */
/* ---------------------------------------------------------------------- */

export const SYSTEM_PROMPT = [
  "You create fictional dating-app characters for a game. Reply with ONE JSON object and nothing else.",
  "",
  "Rules:",
  "- Invent a specific, coherent, likeable person. Fictional only — never real or famous people.",
  "- Keep everything tasteful and safe for work.",
  '- "likes" and "dislikes" must be chosen ONLY from this list (use the exact words):',
  "  " + VOCAB.join(", "),
  '- "imagePrompt": describe only looks, style, setting and mood, matching the bio. One person,',
  "  portrait framing, no text in the image, no real-person likeness.",
  "",
  "Output JSON shaped exactly like:",
  '{"name":"","age":0,"tagline":"","description":"","tags":["",""],"likes":["",""],"dislikes":[""],"imagePrompt":""}',
].join("\n");