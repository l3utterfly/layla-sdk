import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GenRequest,
  type UserModel,
  createUserModel,
  nextRequest,
  recordSwipe,
  readiness,
  pick,
  sample,
  delay,
  VOCAB,
} from "./userModel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Character {
  id: number;
  name: string;
  emoji: string;
  /** [from, to] colours for the portrait gradient */
  gradient: [string, string];
  description: string;
  /** things this character is into */
  likes: string[];
  /** things this character is not into */
  dislikes: string[];
  tags: string[];
  /** taste-model bookkeeping — invisible to the user, used for learning */
  meta: {
    /** the axis values we asked the LLM for → training features on swipe */
    features: Record<string, number>;
    isWildcard: boolean;
  };
}

type Direction = "left" | "right";

/* ------------------------------------------------------------------ */
/*  Character generation                                               */
/* ------------------------------------------------------------------ */
/*
 * Flow per profile:
 *   1. The taste model (userModel.ts) samples a target and builds a short
 *      prompt — `nextRequest(model)`.
 *   2. `generateProfile` sends that prompt to the LLM and parses the JSON.
 *      (The actual network call is the NEXT step — see the TODO below.)
 *   3. The returned character carries `meta.features` (the axis values we
 *      requested) so that, when the user swipes, `recordSwipe` can learn.
 *
 * Until the API is wired in, `generateProfile` returns a local stand-in
 * that honours the requested interests, so the whole loop is observable.
 */

/** How many cards to keep loaded ahead of the current one. */
const LOOKAHEAD = 3;
/** How many cards to request per generation call. */
const BATCH = 3;

// Cosmetic pools for the stand-in profile (names / portraits / flavour).
// The LLM will replace all of this; only `likes`/`dislikes` must stay in VOCAB.
const NAME_POOL = [
  "Luna", "Theo", "Mira", "Kenji", "Nova", "Sage", "Remy", "Mochi",
  "Iris", "Dao", "Wren", "Juno", "Kit", "Otto", "Suki", "Cleo",
  "Milo", "Faye", "Bex", "Pico",
];

const LOOK_POOL: { emoji: string; gradient: [string, string] }[] = [
  { emoji: "🌙", gradient: ["#6A7BA2", "#2E3B5E"] },
  { emoji: "🏄", gradient: ["#FFB36B", "#F2553D"] },
  { emoji: "📚", gradient: ["#C9A26B", "#7A5C3E"] },
  { emoji: "🍜", gradient: ["#E0584F", "#8E2A2A"] },
  { emoji: "🎮", gradient: ["#8E6BF2", "#3B2E6E"] },
  { emoji: "🌿", gradient: ["#7FB07A", "#355E3B"] },
  { emoji: "🎤", gradient: ["#F2A23D", "#C75A12"] },
  { emoji: "🧁", gradient: ["#F2A0C0", "#D96C99"] },
  { emoji: "🛼", gradient: ["#5FB6C9", "#236B7A"] },
  { emoji: "🔭", gradient: ["#5C6BC0", "#2A3470"] },
  { emoji: "🎧", gradient: ["#E08A5F", "#9A4A2A"] },
  { emoji: "☕", gradient: ["#B98B5E", "#6E4A2E"] },
];

const DESCRIPTION_POOL = [
  "Romanticises rainy nights and keeps a telescope on the fire escape.",
  "Always salty from the sea, always grinning, never quite on time.",
  "Will out-quote and out-tea you before you finish saying hello.",
  "Chasing the perfect midnight bowl across every late-night counter in town.",
  "Builds tiny things at 2am with joyful, very specific opinions about them.",
  "Forty houseplants deep and somehow the calmest person in the room.",
  "Makes the awkward silence worse on purpose, lovingly, every time.",
  "Weekend baker and pastel enthusiast, fully committed to the cozy life.",
  "Collects maps of places they haven't been yet, plotting softly.",
  "Three coffees in and ready to reorganise your entire bookshelf.",
  "Knows a hidden rooftop for every season and will take you to all of them.",
  "Talks to dogs first, humans second, and is rarely wrong to.",
];

const TAGS_POOL = [
  "Dreamy", "Creative", "Night owl", "Athletic", "Sunny", "Adventurous", "Bookish",
  "Witty", "Calm", "Foodie", "Spontaneous", "Warm", "Nerdy", "Playful", "Curious",
  "Mindful", "Earthy", "Chill", "Funny", "Bold", "Cozy", "Sweet",
];

/** Local stand-in for a model response. Honours the requested interests. */
function dummyFromRequest(req: GenRequest, id: number): Character {
  const look = pick(LOOK_POOL);
  const likes = [...req.suggestedLikes];
  for (const v of sample(VOCAB, 3)) {
    if (likes.length >= 3) break;
    if (!likes.includes(v)) likes.push(v);
  }
  const dislikes = [...req.suggestedDislikes];
  for (const v of sample(VOCAB, 2)) {
    if (dislikes.length >= 2) break;
    if (!likes.includes(v) && !dislikes.includes(v)) dislikes.push(v);
  }
  return {
    id,
    name: pick(NAME_POOL),
    emoji: look.emoji,
    gradient: look.gradient,
    description: pick(DESCRIPTION_POOL),
    likes,
    dislikes,
    tags: sample(TAGS_POOL, 3),
    meta: { features: req.features, isWildcard: req.isWildcard },
  };
}

/**
 * THE LLM SEAM.
 * Takes a built request and returns one character. The prompt is already
 * assembled by the taste model; here we just send it and parse the reply.
 */
async function generateProfile(req: GenRequest, id: number): Promise<Character> {
  // The exact messages the model will receive:
  const messages = [
    { role: "system", content: req.systemPrompt },
    { role: "user", content: req.userPrompt },
  ];

  // ──────────────────────────────────────────────────────────────────────
  // TODO (next step): call the LLM here and parse its JSON. For a local,
  // OpenAI-compatible endpoint this looks roughly like:
  //
  //   const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
  //     body: JSON.stringify({
  //       model: MODEL,
  //       messages,
  //       temperature: 0.9,
  //       response_format: { type: "json_object" }, // if supported
  //     }),
  //   });
  //   const data = await res.json();
  //   const raw = JSON.parse(data.choices[0].message.content);
  //   return {
  //     id,
  //     name: raw.name,
  //     emoji: pickEmojiFor(raw),        // or have the model return one
  //     gradient: pick(LOOK_POOL).gradient,
  //     description: raw.description,
  //     likes: raw.likes.filter((l: string) => VOCAB.includes(l)),
  //     dislikes: raw.dislikes.filter((d: string) => VOCAB.includes(d)),
  //     tags: raw.tags,
  //     meta: { features: req.features, isWildcard: req.isWildcard },
  //   };
  //   // raw.imagePrompt → feed to the image model behind a fixed style preamble.
  //
  // For now we STOP before the network call and return a local stand-in
  // so the swipe → learn → re-prompt loop runs end to end.
  // ──────────────────────────────────────────────────────────────────────
  void messages;

  await delay(650 + Math.random() * 700); // simulated latency
  return dummyFromRequest(req, id);
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

const HeartIcon = ({ size = 26, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
    <path d="M12 21s-7.5-4.6-10-9.2C.5 8.3 2 4.8 5.3 4.5 7.3 4.3 8.9 5.4 12 8c3.1-2.6 4.7-3.7 6.7-3.5C22 4.8 23.5 8.3 22 11.8 19.5 16.4 12 21 12 21z" />
  </svg>
);

const XIcon = ({ size = 26, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const RewindIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 4v6h6" />
    <path d="M3.5 10a9 9 0 1 1-1.6 5" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

const Tag = ({ label, onDark = false }: { label: string; onDark?: boolean }) => (
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

const ChevronUpIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

      {/* decorative blobs (stand-in for a photo) */}
      <div
        style={{
          position: "absolute",
          width: 260,
          height: 260,
          borderRadius: "50%",
          top: -90,
          right: -70,
          background: "rgba(255,255,255,0.16)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 170,
          height: 170,
          borderRadius: "50%",
          bottom: 90,
          left: -50,
          background: "rgba(0,0,0,0.10)",
        }}
      />

      {/* focal emoji */}
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <span
          style={{
            fontSize: 128,
            filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.32))",
            transform: "translateY(-34px)",
          }}
        >
          {character.emoji}
        </span>
      </div>

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
            letterSpacing: "-0.015em",
            textShadow: "0 2px 16px rgba(0,0,0,0.4)",
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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

  const start = useRef<{ x: number; y: number } | null>(null);
  const nextId = useRef(1);
  const generating = useRef(false);

  // the taste model lives in a ref (mutated in place; not rendered directly)
  const model = useRef<UserModel>(createUserModel());
  const [readinessPct, setReadinessPct] = useState(0);
  const [lastReq, setLastReq] = useState<GenRequest | null>(null);
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

  /* ----- generation: keep a buffer of characters ahead of the deck ----- */
  const topUp = useCallback(async (count: number) => {
    if (generating.current) return;
    generating.current = true;
    setIsGenerating(true);
    try {
      const batch: Character[] = [];
      for (let i = 0; i < count; i++) {
        const req = nextRequest(model.current); // model samples + builds the prompt
        const char = await generateProfile(req, nextId.current++);
        batch.push(char);
        setLastReq(req); // surface the most recent prompt for the dev peek
      }
      setDeck((d) => [...d, ...batch]);
    } finally {
      generating.current = false;
      setIsGenerating(false);
    }
  }, []);

  // Whenever the remaining buffer dips below LOOKAHEAD, request more.
  // This also fires on mount (empty deck) to load the very first cards.
  useEffect(() => {
    if (!generating.current && deck.length - index < LOOKAHEAD) {
      void topUp(BATCH);
    }
  }, [index, deck.length, topUp]);

  const current = deck[index];

  const decide = (dir: Direction) => {
    if (leaving || !current) return;
    setLeaving(dir);
    const char = current;
    // Teach the model immediately: features = the axes we requested for this
    // profile; interests are read from the character itself. (Rewind is a UI
    // undo only and intentionally does not un-learn — the forgetting term in
    // the model washes out a stray swipe over time.)
    recordSwipe(model.current, char.meta.features, char, dir === "right");
    setReadinessPct(Math.round(readiness(model.current) * 100));
    window.setTimeout(() => {
      if (dir === "right") setLiked((l) => [...l, char]);
      else setPassed((p) => p + 1);
      setHistory((h) => [...h, dir]);
      setIndex((i) => i + 1);
      setDrag({ x: 0, y: 0 });
      setLeaving(null);
    }, 320);
  };

  const rewind = () => {
    if (history.length === 0 || leaving) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    if (last === "right") setLiked((l) => l.slice(0, -1));
    else setPassed((p) => Math.max(0, p - 1));
    setDrag({ x: 0, y: 0 });
  };

  /* pointer handlers (top card only) */
  const onPointerDown = (e: React.PointerEvent) => {
    if (leaving) return;
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
    [deck, index]
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
      `}</style>

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
          Find your kindred
        </div>
        <h1
          style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontSize: 40,
            margin: "2px 0 0",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Kindred
        </h1>
      </header>

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
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{readinessPct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: T.line, overflow: "hidden" }}>
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
            color: T.coral,
            fontWeight: 600,
            letterSpacing: "0.02em",
            opacity: isGenerating ? 1 : 0,
            transition: "opacity 0.3s ease",
            animation: "csd-pulse 1.4s ease-in-out infinite",
          }}
        >
          ✨ Summoning more matches…
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
                <div style={{ color: "#E2A13C", marginBottom: 4 }}>// user prompt</div>
                {lastReq.userPrompt}
                <div style={{ color: "#E2A13C", margin: "12px 0 4px" }}>// requested axis features</div>
                {Object.keys(lastReq.features).length
                  ? Object.entries(lastReq.features)
                      .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
                      .join("\n")
                  : "(none this round — pure exploration)"}
                <div style={{ color: "#E2A13C", margin: "12px 0 4px" }}>// system prompt</div>
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
}: {
  top: boolean;
  style: React.CSSProperties;
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      borderRadius: 26,
      overflow: "hidden",
      background: "linear-gradient(150deg, #D9CFBE, #B7AB97)",
      boxShadow: "0 28px 60px -28px rgba(42,36,34,0.45)",
      ...style,
    }}
  >
    {/* shimmer sweep */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
        animation: "csd-shimmer 1.4s linear infinite",
      }}
    />

    {/* placeholder content */}
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
      <div style={{ width: "55%", height: 30, borderRadius: 8, background: "rgba(255,255,255,0.5)" }} />
      <div style={{ width: "92%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.4)" }} />
      <div style={{ width: "76%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.4)" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        {[58, 46, 52].map((w, i) => (
          <div
            key={i}
            style={{ width: w, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.35)" }}
          />
        ))}
      </div>

      {top && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.96)",
              letterSpacing: "0.02em",
              marginBottom: 7,
              textShadow: "0 1px 6px rgba(0,0,0,0.25)",
            }}
          >
            ✨ Summoning a match…
          </div>
          <div
            style={{
              position: "relative",
              height: 6,
              borderRadius: 999,
              background: "rgba(255,255,255,0.3)",
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
        </div>
      )}
    </div>
  </div>
);