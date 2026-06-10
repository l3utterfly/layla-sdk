import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LaylaError,
  LaylaSDK,
  type LaylaChatMessage,
  type LaylaCharacter,
  type TavernCardV2,
} from "../../../src/index";
import {
  type GenRequest,
  type UserModel,
  createUserModel,
  nextRequest,
  recordSwipe,
  readiness,
  VOCAB,
} from "./userModel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Character {
  id: number;
  name: string;
  /** [from, to] colours for the portrait gradient */
  gradient: [string, string];
  description: string;
  /** things this character is into */
  likes: string[];
  /** things this character is not into */
  dislikes: string[];
  tags: string[];
  imageUrl: string;
  imagePrompt: string;
  /** taste-model bookkeeping — invisible to the user, used for learning */
  meta: {
    /** the axis values we asked the LLM for → training features on swipe */
    features: Record<string, number>;
    isWildcard: boolean;
  };
}

type Direction = "left" | "right";
type GenderFilter = "any" | "male" | "female";
type SaveState = {
  phase: "saving" | "success" | "error";
  message: string;
} | null;

interface GenerationState {
  phase: "profile" | "image" | "error";
  responseText: string;
  imageStatus: string;
  imageStep: number;
  imageTotalSteps: number;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Character generation                                               */
/* ------------------------------------------------------------------ */
/*
 * Flow per profile:
 *   1. The taste model (userModel.ts) samples a target and builds a short
 *      prompt — `nextRequest(model)`.
 *   2. `generateProfile` streams that prompt to Layla and parses the JSON.
 *   3. The returned character carries `meta.features` (the axis values we
 *      requested) so that, when the user swipes, `recordSwipe` can learn.
 */

const layla = new LaylaSDK();

const PORTRAIT_GRADIENTS: [string, string][] = [
  ["#6A7BA2", "#2E3B5E"],
  ["#FFB36B", "#F2553D"],
  ["#C9A26B", "#7A5C3E"],
  ["#E0584F", "#8E2A2A"],
  ["#8E6BF2", "#3B2E6E"],
  ["#7FB07A", "#355E3B"],
  ["#F2A23D", "#C75A12"],
  ["#F2A0C0", "#D96C99"],
  ["#5FB6C9", "#236B7A"],
  ["#5C6BC0", "#2A3470"],
  ["#E08A5F", "#9A4A2A"],
  ["#B98B5E", "#6E4A2E"],
];

interface GeneratedProfile {
  name: string;
  age: number;
  tagline: string;
  description: string;
  tags: string[];
  likes: string[];
  dislikes: string[];
  imagePrompt: string;
}

type JsonRecord = Record<string, unknown>;

const PROFILE_FIELD_ALIASES = {
  name: [
    "name",
    "characterName",
    "character_name",
    "character name",
    "fullName",
    "full_name",
  ],
  age: ["age", "years", "yearsOld", "years_old"],
  tagline: [
    "tagline",
    "tag_line",
    "title",
    "headline",
    "oneLiner",
    "one_liner",
  ],
  description: ["description", "bio", "about", "summary", "profile"],
  tags: ["tags", "traits", "vibe", "vibes"],
  likes: [
    "likes",
    "interests",
    "into",
    "hobbies",
    "favoriteThings",
    "favorite_things",
  ],
  dislikes: [
    "dislikes",
    "notInto",
    "not_into",
    "turnoffs",
    "turnOffs",
    "dealbreakers",
  ],
  imagePrompt: [
    "imagePrompt",
    "image_prompt",
    "portraitPrompt",
    "portrait_prompt",
    "appearance",
    "look",
  ],
};

const PROFILE_ALIAS_LOOKUP = new Map<
  string,
  keyof typeof PROFILE_FIELD_ALIASES
>(
  Object.entries(PROFILE_FIELD_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [
      normalizeFieldName(alias),
      field as keyof typeof PROFILE_FIELD_ALIASES,
    ]),
  ),
);

function repairJsonish(text: string): string {
  return text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonish(text: string): unknown {
  const cleaned = repairJsonish(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const quotedKeys = cleaned.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');
    const quotedStrings = quotedKeys.replace(/:\s*'([^'\n\r]*)'/g, ': "$1"');
    return JSON.parse(quotedStrings);
  }
}

function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function balancedJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const opener = text[i];
    if (opener !== "{" && opener !== "[") continue;
    const closers = opener === "{" ? ["}"] : ["]"];
    const stack = [closers[0]];
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let j = i + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
      } else if (ch === "{") {
        stack.push("}");
      } else if (ch === "[") {
        stack.push("]");
      } else if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          candidates.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function findObjectLike(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectLike(item);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const object = value as JsonRecord;
  const keys = Object.keys(object).map(normalizeFieldName);
  if (keys.some((key) => PROFILE_ALIAS_LOOKUP.has(key))) return object;

  for (const key of ["profile", "character", "data", "result"]) {
    const found = findObjectLike(object[key]);
    if (found) return found;
  }
  return null;
}

function looseValue(value: string): unknown {
  const trimmed = repairJsonish(value).replace(/,$/, "").trim();
  if (!trimmed) return "";

  if (/^[-+]?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'")
  ) {
    try {
      return parseJsonish(trimmed);
    } catch {
      // Fall through to returning a plain string.
    }
  }

  return trimmed.replace(/^["']|["']$/g, "").trim();
}

function extractLooseProfileFields(text: string): JsonRecord {
  const fields: JsonRecord = {};
  const pairPattern =
    /["']?([A-Za-z][\w -]*)["']?\s*[:=]\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\[[^\]]*\]|[^\n,}]+)/g;

  for (const match of text.matchAll(pairPattern)) {
    const field = PROFILE_ALIAS_LOOKUP.get(normalizeFieldName(match[1]));
    if (field && fields[field] === undefined)
      fields[field] = looseValue(match[2]);
  }

  return fields;
}

function extractJsonObject(text: string): JsonRecord {
  const candidates = [
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(
      (match) => match[1],
    ),
    text,
    ...balancedJsonCandidates(text),
  ];

  for (const candidate of candidates) {
    try {
      const object = findObjectLike(parseJsonish(candidate));
      if (object) return object;
    } catch {
      // Try the next candidate.
    }
  }

  return extractLooseProfileFields(text);
}

function stringField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function stringArrayField(...values: unknown[]): string[] {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const items = Object.values(value)
        .map((item) => stringField(item))
        .filter(Boolean);
      if (items.length) return items;
    }
    if (Array.isArray(value)) {
      const items = value
        .flatMap((item) =>
          typeof item === "string" ? item.split(",") : [item],
        )
        .map((item) => stringField(item))
        .filter(Boolean);
      if (items.length) return items;
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function fieldValues(data: JsonRecord, aliases: string[]): unknown[] {
  const names = new Set(aliases.map(normalizeFieldName));
  const values: unknown[] = [];
  const nestedKeys = new Set([
    "profile",
    "character",
    "data",
    "result",
    "details",
  ]);

  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 3) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    const object = value as JsonRecord;
    for (const [key, item] of Object.entries(object)) {
      if (names.has(normalizeFieldName(key))) values.push(item);
    }
    for (const [key, item] of Object.entries(object)) {
      if (nestedKeys.has(normalizeFieldName(key))) visit(item, depth + 1);
    }
  }

  visit(data, 0);
  return values;
}

function vocabItems(
  items: string[],
  requested: string[],
  max: number,
): string[] {
  const valid = new Set(VOCAB);
  const out: string[] = [];
  for (const item of [...items, ...requested]) {
    if (valid.has(item) && !out.includes(item)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function parseGeneratedProfile(text: string): GeneratedProfile {
  const data = extractJsonObject(text);
  const name = stringField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.name),
    "Mystery Match",
  );
  const tagline = stringField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.tagline),
  );
  const likes = stringArrayField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.likes),
  );
  const dislikes = stringArrayField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.dislikes),
  );
  const tags = stringArrayField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.tags),
  ).slice(0, 4);
  const description = stringField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.description),
    tagline,
    `${name} is a fictional dating-app character.`,
  );
  const imagePrompt = stringField(
    ...fieldValues(data, PROFILE_FIELD_ALIASES.imagePrompt),
    `${name}, ${description}, ${tags.join(", ")}`,
  );
  const ageValue = stringField(...fieldValues(data, PROFILE_FIELD_ALIASES.age));
  const parsedAge = Number.parseInt(ageValue, 10);

  return {
    name,
    age: Number.isFinite(parsedAge) ? parsedAge : 0,
    tagline,
    description,
    tags,
    likes,
    dislikes,
    imagePrompt,
  };
}

function characterFromProfile(
  raw: GeneratedProfile,
  req: GenRequest,
  id: number,
): Character {
  const ageSuffix = raw.age > 0 ? `, ${Math.round(raw.age)}` : "";
  const description = raw.tagline
    ? `${raw.tagline}${ageSuffix}. ${raw.description}`
    : `${raw.description}${ageSuffix ? ` (${Math.round(raw.age)})` : ""}`;

  return {
    id,
    name: raw.name,
    gradient: PORTRAIT_GRADIENTS[id % PORTRAIT_GRADIENTS.length],
    description,
    likes: vocabItems(raw.likes, req.suggestedLikes, 3),
    dislikes: vocabItems(raw.dislikes, req.suggestedDislikes, 2),
    tags: raw.tags.slice(0, 3),
    imageUrl: "",
    imagePrompt: raw.imagePrompt,
    meta: { features: req.features, isWildcard: req.isWildcard },
  };
}

function profileUserPrompt(
  req: GenRequest,
  genderFilter: GenderFilter,
): string {
  if (genderFilter === "any") return req.userPrompt;
  return `Gender: ${genderFilter}. Generate only a ${genderFilter} character.\n${req.userPrompt}`;
}

function fullImagePrompt(
  profile: GeneratedProfile,
  genderFilter: GenderFilter,
): string {
  const genderPrefix = genderFilter === "any" ? "" : `${genderFilter}, `;
  return [`${genderPrefix}`, profile.imagePrompt].join(" ");
}

async function generateImageWithTimeout(
  prompt: string,
  onProgress: (status: string, step: number, totalSteps: number) => void,
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 45000);
  try {
    return await layla.images.generateImage(prompt, onProgress, {
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof LaylaError) return error.message;
  if (error instanceof SyntaxError)
    return `Invalid JSON from Layla: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Layla generation failed.";
}

function initialGenerationState(): GenerationState {
  return {
    phase: "profile",
    responseText: "",
    imageStatus: "",
    imageStep: 0,
    imageTotalSteps: 1,
    error: null,
  };
}

function savedCharacterCard(character: Character): LaylaCharacter {
  const card: TavernCardV2 = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: character.name,
      description: character.description,
      personality: [
        ...character.tags,
        ...character.likes.map((item) => `likes ${item}`),
        ...character.dislikes.map((item) => `dislikes ${item}`),
      ].join(", "),
      scenario: "A fictional dating-app match generated in Layla Swipe.",
      first_mes: `Hey, I'm ${character.name}.`,
      mes_example: "",
      creator_notes: `Generated from prompt: ${character.imagePrompt}`,
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: character.tags,
      creator: "Layla Swipe",
      character_version: "1.0",
      extensions: {
        image: character.imageUrl,
        laylaSwipe: {
          likes: character.likes,
          dislikes: character.dislikes,
          imagePrompt: character.imagePrompt,
          features: character.meta.features,
          isWildcard: character.meta.isWildcard,
        },
      },
    },
  };

  return {
    id: `swipe-generated-${character.id}`,
    data: card,
  };
}

async function saveGeneratedCharacter(character: Character): Promise<string> {
  return layla.characters.update(savedCharacterCard(character));
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/**
 * THE LLM SEAM.
 * Takes a built request and returns one character. The prompt is already
 * assembled by the taste model; here we just send it and parse the reply.
 */
async function generateProfile(
  req: GenRequest,
  id: number,
  genderFilter: GenderFilter,
  onProgress: (state: GenerationState) => void,
): Promise<Character> {
  // The exact messages the model will receive:
  const messages: LaylaChatMessage[] = [
    { role: "system", content: req.systemPrompt },
    { role: "user", content: profileUserPrompt(req, genderFilter) },
  ];

  onProgress({
    phase: "profile",
    responseText: "",
    imageStatus: "",
    imageStep: 0,
    imageTotalSteps: 1,
    error: null,
  });

  const stream = layla.chat.completions.stream({ messages });
  stream.on("content", (_delta, snapshot) => {
    onProgress({
      phase: "profile",
      responseText: snapshot,
      imageStatus: "",
      imageStep: 0,
      imageTotalSteps: 1,
      error: null,
    });
  });

  const content = await stream.finalContent();
  const profile = parseGeneratedProfile(content);
  const character = characterFromProfile(profile, req, id);

  onProgress({
    phase: "image",
    responseText: content,
    imageStatus: "Preparing portrait",
    imageStep: 0,
    imageTotalSteps: 1,
    error: null,
  });

  const imageUrl = await generateImageWithTimeout(
    fullImagePrompt(profile, genderFilter),
    (status, step, totalSteps) => {
      onProgress({
        phase: "image",
        responseText: content,
        imageStatus: status,
        imageStep: step,
        imageTotalSteps: Math.max(1, totalSteps),
        error: null,
      });
    },
  );

  if (!imageUrl) {
    throw new Error(
      "Layla image generation finished without returning an image.",
    );
  }

  return { ...character, imageUrl };
}

/* ------------------------------------------------------------------ */
/*  Theme tokens                                                       */
/* ------------------------------------------------------------------ */

const T = {
  paper: "#F2E9DB",
  card: "#FFFDF8",
  ink: "#2A2422",
  inkSoft: "#7A6B5E",
  coral: "#F2553D",
  slate: "#42525E",
  amber: "#E2A13C",
  line: "rgba(42, 36, 34, 0.10)",
};

const SWIPE_THRESHOLD = 110;

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const HeartIcon = ({
  size = 26,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
    <path d="M12 21s-7.5-4.6-10-9.2C.5 8.3 2 4.8 5.3 4.5 7.3 4.3 8.9 5.4 12 8c3.1-2.6 4.7-3.7 6.7-3.5C22 4.8 23.5 8.3 22 11.8 19.5 16.4 12 21 12 21z" />
  </svg>
);

const XIcon = ({
  size = 26,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={3}
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const RewindIcon = ({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 4v6h6" />
    <path d="M3.5 10a9 9 0 1 1-1.6 5" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

const Tag = ({
  label,
  onDark = false,
}: {
  label: string;
  onDark?: boolean;
}) => (
  <span
    style={{
      fontSize: 10.5,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      fontWeight: 600,
      color: onDark ? "rgba(255,255,255,0.95)" : T.inkSoft,
      border: `1px solid ${onDark ? "rgba(255,255,255,0.5)" : T.line}`,
      background: onDark ? "rgba(255,255,255,0.14)" : "transparent",
      backdropFilter: onDark ? "blur(4px)" : undefined,
      borderRadius: 999,
      padding: "4px 10px",
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </span>
);

const ChevronUpIcon = ({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 15l6-6 6 6" />
  </svg>
);

const TraitRow = ({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "like" | "dislike";
}) => {
  const accent = tone === "like" ? T.coral : T.slate;
  const tint = tone === "like" ? "rgba(242,85,61,0.10)" : "rgba(66,82,94,0.10)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: accent,
          marginTop: 5,
          minWidth: 52,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((it) => (
          <span
            key={it}
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: T.ink,
              background: tint,
              borderRadius: 8,
              padding: "3px 9px",
            }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  The card                                                           */
/* ------------------------------------------------------------------ */

interface CardProps {
  character: Character;
  style: React.CSSProperties;
  interactive: boolean;
  likeOpacity?: number;
  nopeOpacity?: number;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

const Card: React.FC<CardProps> = ({
  character,
  style,
  interactive,
  likeOpacity = 0,
  nopeOpacity = 0,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [from, to] = character.gradient;

  // dragging is suspended while the detail sheet is open
  const allowDrag = interactive && !expanded;
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      onPointerDown={allowDrag ? onPointerDown : undefined}
      onPointerMove={allowDrag ? onPointerMove : undefined}
      onPointerUp={allowDrag ? onPointerUp : undefined}
      onPointerCancel={allowDrag ? onPointerUp : undefined}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 26,
        background: `linear-gradient(150deg, ${from}, ${to})`,
        boxShadow:
          "0 28px 60px -28px rgba(42,36,34,0.55), 0 2px 0 rgba(255,255,255,0.5) inset",
        overflow: "hidden",
        touchAction: "none",
        cursor: allowDrag ? "grab" : "default",
        userSelect: "none",
        ...style,
      }}
    >
      {character.meta.isWildcard && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 3,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#3a2e12",
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(255,255,255,0.7)",
            borderRadius: 999,
            padding: "4px 10px",
            boxShadow: "0 4px 14px -6px rgba(0,0,0,0.4)",
          }}
        >
          ✨ Wildcard
        </div>
      )}

      <img
        src={character.imageUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
        }}
      />

      {/* legibility scrim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 38%, rgba(0,0,0,0) 66%)",
        }}
      />

      {/* LIKE / NOPE stamps */}
      <Stamp text="LIKE" color={T.coral} side="left" opacity={likeOpacity} />
      <Stamp text="NOPE" color={T.slate} side="right" opacity={nopeOpacity} />

      {/* overlay content */}
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          bottom: 20,
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        <h2
          style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontSize: 38,
            lineHeight: 1,
            margin: 0,
            fontWeight: 600,
            letterSpacing: 0,
            color: "#fff",
            WebkitTextFillColor: "#fff",
            WebkitTextStroke: "1.25px rgba(0,0,0,0.95)",
            textShadow:
              "0 2px 0 rgba(0,0,0,0.95), 1px 0 0 rgba(0,0,0,0.95), -1px 0 0 rgba(0,0,0,0.95), 0 -1px 0 rgba(0,0,0,0.95), 0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          {character.name}
        </h2>

        <p
          className="csd-clamp2"
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.92)",
            textShadow: "0 1px 10px rgba(0,0,0,0.4)",
          }}
        >
          {character.description}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {character.tags.map((t) => (
            <Tag key={t} label={t} onDark />
          ))}
        </div>

        <button
          onPointerDown={stop}
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 2,
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            border: "1px solid rgba(255,255,255,0.5)",
            background: "rgba(255,255,255,0.16)",
            backdropFilter: "blur(4px)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "0.01em",
            padding: "8px 14px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          <ChevronUpIcon /> What they’re into
        </button>
      </div>

      {/* detail sheet */}
      <div
        onPointerDown={stop}
        onClick={() => setExpanded(false)}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      />
      <div
        onPointerDown={stop}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: T.card,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          boxShadow: "0 -16px 40px -18px rgba(0,0,0,0.5)",
          padding: "12px 22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          transform: expanded ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.34s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: T.line,
            alignSelf: "center",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3
            style={{
              fontFamily: "'Fraunces', Georgia, serif",
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              color: T.ink,
            }}
          >
            {character.name}’s vibe
          </h3>
          <button
            onClick={() => setExpanded(false)}
            aria-label="Close details"
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              border: `1px solid ${T.line}`,
              background: "transparent",
              color: T.inkSoft,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        <TraitRow label="Into" items={character.likes} tone="like" />
        <TraitRow label="Not into" items={character.dislikes} tone="dislike" />
      </div>
    </div>
  );
};

const Stamp = ({
  text,
  color,
  side,
  opacity,
}: {
  text: string;
  color: string;
  side: "left" | "right";
  opacity: number;
}) => (
  <div
    style={{
      position: "absolute",
      top: 22,
      [side]: 20,
      transform: `rotate(${side === "left" ? -16 : 16}deg)`,
      border: `3px solid ${color}`,
      color,
      fontWeight: 800,
      fontSize: 24,
      letterSpacing: "0.08em",
      padding: "4px 12px",
      borderRadius: 8,
      opacity: Math.max(0, Math.min(1, opacity)),
      transition: "opacity 0.1s linear",
      background: "rgba(255,255,255,0.85)",
      pointerEvents: "none",
    }}
  >
    {text}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Action button                                                      */
/* ------------------------------------------------------------------ */

const ActionButton = ({
  onClick,
  color,
  size,
  children,
  disabled,
  title,
}: {
  onClick: () => void;
  color: string;
  size: number;
  children: React.ReactNode;
  disabled?: boolean;
  title: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={title}
    title={title}
    className="csd-btn"
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      border: `1.5px solid ${T.line}`,
      background: T.card,
      color,
      display: "grid",
      placeItems: "center",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      boxShadow: "0 10px 22px -12px rgba(42,36,34,0.5)",
    }}
  >
    {children}
  </button>
);

const SaveModal = ({ state }: { state: SaveState }) => {
  if (!state) return null;

  const isSaving = state.phase === "saving";
  const accent = state.phase === "error" ? T.slate : T.coral;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(42, 36, 34, 0.42)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "min(82vw, 260px)",
          minHeight: 132,
          borderRadius: 8,
          background: T.card,
          color: T.ink,
          boxShadow: "0 28px 70px -32px rgba(42,36,34,0.72)",
          display: "grid",
          placeItems: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
        }}
      >
        {isSaving ? (
          <div
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `3px solid ${T.line}`,
              borderTopColor: accent,
              animation: "csd-spin .8s linear infinite",
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: accent,
              color: T.card,
              display: "grid",
              placeItems: "center",
              fontSize: 21,
              fontWeight: 800,
            }}
          >
            {state.phase === "success" ? "OK" : "!"}
          </div>
        )}
        <div
          style={{
            fontSize: state.phase === "success" ? 22 : 15,
            fontWeight: 700,
            color: state.phase === "success" ? T.coral : T.ink,
            lineHeight: 1.2,
          }}
        >
          {state.message}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CharacterSwipeDeck() {
  const [deck, setDeck] = useState<Character[]>([]);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<Direction | null>(null);
  const [liked, setLiked] = useState<Character[]>([]);
  const [passed, setPassed] = useState(0);
  const [history, setHistory] = useState<Direction[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("any");
  const [saveState, setSaveState] = useState<SaveState>(null);

  const start = useRef<{ x: number; y: number } | null>(null);
  const nextId = useRef(1);
  const generating = useRef(false);
  const swiping = useRef(false);

  // the taste model lives in a ref (mutated in place; not rendered directly)
  const model = useRef<UserModel>(createUserModel());
  const [readinessPct, setReadinessPct] = useState(0);
  const [lastReq, setLastReq] = useState<GenRequest | null>(null);
  const [lastGenderFilter, setLastGenderFilter] = useState<GenderFilter>("any");
  const [showPrompt, setShowPrompt] = useState(false);

  /* inject fonts once */
  useEffect(() => {
    const id = "csd-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  /* ----- generation: create one character only when the deck is exhausted ----- */
  const generateNext = useCallback(async () => {
    if (generating.current) return;
    generating.current = true;
    setIsGenerating(true);
    try {
      const req = nextRequest(model.current); // model samples + builds the prompt
      setLastReq(req); // surface the most recent prompt for the dev peek
      setLastGenderFilter(genderFilter);
      setGeneration(initialGenerationState());
      try {
        const char = await generateProfile(
          req,
          nextId.current++,
          genderFilter,
          setGeneration,
        );
        setDeck((d) => [...d, char]);
        setGeneration(null);
      } catch (error) {
        const message = errorMessage(error);
        setGeneration((current) => ({
          ...(current ?? initialGenerationState()),
          phase: "error",
          error: message,
        }));
      }
    } finally {
      generating.current = false;
      setIsGenerating(false);
    }
  }, [genderFilter]);

  // Generate only when there is no current card left to show.
  // This also fires on mount (empty deck) to load the very first card.
  useEffect(() => {
    if (
      !generating.current &&
      generation?.phase !== "error" &&
      index >= deck.length
    ) {
      void generateNext();
    }
  }, [generation?.phase, index, deck.length, generateNext]);

  const current = deck[index];

  const retryGeneration = () => {
    setGeneration(null);
    void generateNext();
  };

  const finishSwipe = (dir: Direction, char: Character) => {
    if (!swiping.current) return;
    if (dir === "right") setLiked((l) => [...l, char]);
    else setPassed((p) => p + 1);
    setHistory((h) => [...h, dir]);
    setIndex((i) => i + 1);
    setDrag({ x: 0, y: 0 });
    setLeaving(null);
    swiping.current = false;
  };

  const decide = async (dir: Direction) => {
    if (swiping.current || leaving || !current) return;
    swiping.current = true;
    setLeaving(dir);
    const char = current;
    // Teach the model immediately: features = the axes we requested for this
    // profile; interests are read from the character itself. (Rewind is a UI
    // undo only and intentionally does not un-learn — the forgetting term in
    // the model washes out a stray swipe over time.)
    recordSwipe(model.current, char.meta.features, char, dir === "right");
    setReadinessPct(Math.round(readiness(model.current) * 100));

    if (dir === "right") {
      setSaveState({ phase: "saving", message: `Saving ${char.name}` });
      try {
        await saveGeneratedCharacter(char);
        setSaveState({ phase: "success", message: "success" });
        await delay(850);
      } catch (error) {
        setSaveState({ phase: "error", message: errorMessage(error) });
        await delay(1600);
      } finally {
        setSaveState(null);
        finishSwipe(dir, char);
      }
      return;
    }

    window.setTimeout(() => finishSwipe(dir, char), 320);
  };

  const rewind = () => {
    if (history.length === 0 || leaving || saveState) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    if (last === "right") setLiked((l) => l.slice(0, -1));
    else setPassed((p) => Math.max(0, p - 1));
    setDrag({ x: 0, y: 0 });
  };

  /* pointer handlers (top card only) */
  const onPointerDown = (e: React.PointerEvent) => {
    if (swiping.current || leaving || saveState) return;
    start.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onPointerUp = () => {
    if (!start.current) return;
    setDragging(false);
    start.current = null;
    if (drag.x > SWIPE_THRESHOLD) decide("right");
    else if (drag.x < -SWIPE_THRESHOLD) decide("left");
    else setDrag({ x: 0, y: 0 });
  };

  const likeOpacity = drag.x / SWIPE_THRESHOLD;
  const nopeOpacity = -drag.x / SWIPE_THRESHOLD;

  // The three visible slots: top card + two peeking behind. Any slot that
  // isn't loaded yet (undefined) renders as a skeleton LoadingCard.
  const slots = useMemo(
    () => [0, 1, 2].map((i) => deck[index + i]),
    [deck, index],
  );

  /* top-card transform */
  const topTransform = (() => {
    if (leaving) {
      const d = leaving === "right" ? 1 : -1;
      return `translate(${d * 640}px, ${drag.y + 40}px) rotate(${d * 18}deg)`;
    }
    return `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.06}deg)`;
  })();

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
        color: T.ink,
        background: `radial-gradient(900px 600px at 15% -10%, rgba(242,85,61,0.16), transparent 60%),
                     radial-gradient(800px 600px at 95% 110%, rgba(226,161,60,0.18), transparent 55%),
                     ${T.paper}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "26px 16px 40px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        .csd-clamp2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .csd-btn { transition: transform .14s ease, box-shadow .14s ease; }
        .csd-btn:not(:disabled):hover { transform: translateY(-3px) scale(1.05); }
        .csd-btn:not(:disabled):active { transform: translateY(0) scale(0.96); }
        @keyframes csd-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes csd-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes csd-bar { 0% { left: -40%; } 100% { left: 100%; } }
        @keyframes csd-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes csd-spin { to { transform: rotate(360deg); } }
      `}</style>

      <SaveModal state={saveState} />

      {/* Header */}
      <header
        style={{
          textAlign: "center",
          marginBottom: 18,
          animation: "csd-rise .5s ease both",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: T.coral,
            fontWeight: 700,
          }}
        >
          Find your match
        </div>
      </header>

      <div
        role="radiogroup"
        aria-label="Gender filter"
        style={{
          width: "min(90vw, 372px)",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          padding: 4,
          marginBottom: 14,
          border: `1px solid ${T.line}`,
          borderRadius: 999,
          background: "rgba(255,253,248,0.56)",
          animation: "csd-rise .52s .02s ease both",
        }}
      >
        {(
          [
            ["any", "Any"],
            ["male", "Only male"],
            ["female", "Only female"],
          ] as const
        ).map(([value, label]) => {
          const active = genderFilter === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isGenerating}
              onClick={() => setGenderFilter(value)}
              style={{
                minHeight: 32,
                border: 0,
                borderRadius: 999,
                background: active ? T.ink : "transparent",
                color: active ? T.card : T.inkSoft,
                fontFamily: "inherit",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: isGenerating ? "not-allowed" : "pointer",
                opacity: isGenerating && !active ? 0.55 : 1,
                transition:
                  "background 0.18s ease, color 0.18s ease, opacity 0.18s ease",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Readiness meter (driven by the hidden taste model) */}
      <div
        style={{
          width: "min(90vw, 372px)",
          marginBottom: 16,
          animation: "csd-rise .55s .04s ease both",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: T.inkSoft,
            marginBottom: 5,
          }}
        >
          <span style={{ letterSpacing: "0.02em" }}>Reading your taste</span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {readinessPct}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: T.line,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${readinessPct}%`,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${T.amber}, ${T.coral})`,
              transition: "width 0.5s cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
      </div>

      {/* Deck */}
      <div
        style={{
          position: "relative",
          width: "min(90vw, 372px)",
          height: "min(74vh, 620px)",
          animation: "csd-rise .55s .08s ease both",
        }}
      >
        {slots
          .map((char, i) => {
            const isTop = i === 0;
            const behindStyle: React.CSSProperties = {
              transform: `translateY(${i * 16}px) scale(${1 - i * 0.045})`,
              transition: "transform 0.35s cubic-bezier(.2,.8,.2,1)",
              zIndex: 10 - i,
              filter: "saturate(0.92)",
            };
            const topStyle: React.CSSProperties = {
              transform: topTransform,
              transition: dragging
                ? "none"
                : "transform 0.35s cubic-bezier(.2,.8,.2,1)",
              zIndex: 10,
            };

            if (!char) {
              return (
                <LoadingCard
                  key={`load-${index + i}`}
                  top={isTop}
                  style={isTop ? { zIndex: 10 } : behindStyle}
                  generation={isTop ? generation : null}
                  onRetry={retryGeneration}
                />
              );
            }

            return (
              <Card
                key={char.id}
                character={char}
                interactive={isTop}
                style={isTop ? topStyle : behindStyle}
                likeOpacity={isTop ? likeOpacity : 0}
                nopeOpacity={isTop ? nopeOpacity : 0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            );
          })
          /* render bottom cards first so the top card paints last */
          .reverse()}
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          marginTop: 26,
          animation: "csd-rise .6s .16s ease both",
        }}
      >
        <ActionButton
          onClick={() => decide("left")}
          color={T.slate}
          size={62}
          title="Pass"
          disabled={!current || !!leaving}
        >
          <XIcon />
        </ActionButton>
        <ActionButton
          onClick={rewind}
          color={T.amber}
          size={46}
          disabled={history.length === 0}
          title="Rewind"
        >
          <RewindIcon />
        </ActionButton>
        <ActionButton
          onClick={() => decide("right")}
          color={T.coral}
          size={62}
          title="Like"
          disabled={!current || !!leaving}
        >
          <HeartIcon />
        </ActionButton>
      </div>

      {/* Stats + background generation indicator */}
      <div
        style={{
          marginTop: 16,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minHeight: 34,
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: T.inkSoft }}>
          {liked.length} liked · {passed} passed
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            color: generation?.phase === "error" ? T.slate : T.coral,
            fontWeight: 600,
            letterSpacing: "0.02em",
            opacity: isGenerating || generation?.phase === "error" ? 1 : 0,
            transition: "opacity 0.3s ease",
            animation:
              generation?.phase === "error"
                ? undefined
                : "csd-pulse 1.4s ease-in-out infinite",
          }}
        >
          {generation?.phase === "error"
            ? generation.error
            : "✨ Summoning more matches…"}
        </p>
      </div>

      {/* Dev peek: the actual prompt the model just built (wire the API next) */}
      <div style={{ width: "min(90vw, 372px)", marginTop: 14 }}>
        <button
          onClick={() => setShowPrompt((s) => !s)}
          style={{
            border: `1px solid ${T.line}`,
            background: "transparent",
            color: T.inkSoft,
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          {showPrompt ? "Hide" : "🔍 Peek at"} the generated prompt
        </button>

        {showPrompt && (
          <div
            style={{
              marginTop: 10,
              background: "#231f1d",
              color: "#EBE3D6",
              borderRadius: 14,
              padding: 14,
              fontSize: 11.5,
              lineHeight: 1.5,
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            {lastReq ? (
              <>
                <div style={{ color: "#E2A13C", marginBottom: 4 }}>
                  // user prompt
                </div>
                {profileUserPrompt(lastReq, lastGenderFilter)}
                <div style={{ color: "#E2A13C", margin: "12px 0 4px" }}>
                  // requested axis features
                </div>
                {Object.keys(lastReq.features).length
                  ? Object.entries(lastReq.features)
                      .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
                      .join("\n")
                  : "(none this round — pure exploration)"}
                <div style={{ color: "#E2A13C", margin: "12px 0 4px" }}>
                  // system prompt
                </div>
                <span style={{ opacity: 0.7 }}>{lastReq.systemPrompt}</span>
              </>
            ) : (
              "Generating the first profile…"
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading card (shown while a character is being generated)          */
/* ------------------------------------------------------------------ */

const LoadingCard = ({
  top,
  style,
  generation,
  onRetry,
}: {
  top: boolean;
  style: React.CSSProperties;
  generation: GenerationState | null;
  onRetry: () => void;
}) => {
  const imageProgress =
    generation?.phase === "image"
      ? Math.max(
          0,
          Math.min(
            100,
            (generation.imageStep / generation.imageTotalSteps) * 100,
          ),
        )
      : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 26,
        overflow: "hidden",
        background:
          generation?.phase === "error"
            ? "linear-gradient(150deg, #BFC5C8, #7B8992)"
            : "linear-gradient(150deg, #D9CFBE, #B7AB97)",
        boxShadow: "0 28px 60px -28px rgba(42,36,34,0.45)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.32) 50%, transparent 70%)",
          animation:
            generation?.phase === "error"
              ? undefined
              : "csd-shimmer 1.4s linear infinite",
        }}
      />

      {!top || !generation ? (
        <div
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            bottom: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              width: "55%",
              height: 30,
              borderRadius: 8,
              background: "rgba(255,255,255,0.5)",
            }}
          />
          <div
            style={{
              width: "92%",
              height: 12,
              borderRadius: 6,
              background: "rgba(255,255,255,0.4)",
            }}
          />
          <div
            style={{
              width: "76%",
              height: 12,
              borderRadius: 6,
              background: "rgba(255,255,255,0.4)",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            {[58, 46, 52].map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 22,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.35)",
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 18,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            color: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.75)",
                }}
              >
                {generation.phase === "error"
                  ? "Generation error"
                  : generation.phase === "image"
                    ? "Rendering portrait"
                    : "Writing profile"}
              </div>
              <div
                style={{
                  fontFamily: "'Fraunces', Georgia, serif",
                  fontSize: 25,
                  fontWeight: 600,
                  marginTop: 2,
                  textShadow: "0 2px 12px rgba(0,0,0,0.25)",
                }}
              >
                {generation.phase === "error"
                  ? "Layla needs attention"
                  : "New match incoming"}
              </div>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              border: "1px solid rgba(255,255,255,0.34)",
              background: "rgba(35,31,29,0.58)",
              borderRadius: 16,
              padding: 14,
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 11.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "auto",
              boxShadow: "0 18px 34px -24px rgba(0,0,0,0.7) inset",
            }}
          >
            {generation.phase === "error"
              ? generation.error
              : generation.responseText ||
                "Waiting for Layla to start typing..."}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {generation.phase === "image" && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.9)",
                  }}
                >
                  <span>{generation.imageStatus || "Generating portrait"}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(imageProgress)}%
                  </span>
                </div>
                <div
                  style={{
                    height: 7,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.28)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${imageProgress}%`,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.96)",
                      transition: "width 0.25s ease",
                    }}
                  />
                </div>
              </>
            )}

            {generation.phase === "profile" && (
              <div
                style={{
                  position: "relative",
                  height: 7,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.28)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: "40%",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.96)",
                    animation: "csd-bar 1.2s ease-in-out infinite",
                  }}
                />
              </div>
            )}

            {generation.phase === "error" && (
              <button
                onClick={onRetry}
                style={{
                  alignSelf: "flex-start",
                  border: "1px solid rgba(255,255,255,0.48)",
                  background: "rgba(255,255,255,0.16)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: "8px 14px",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
