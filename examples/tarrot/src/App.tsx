import React, { useState, useRef, useEffect, useMemo } from "react";
import { Sparkles, Send, Moon, Eye, Shuffle, RotateCcw, Stars, ChevronDown, ChevronRight, MessageCircle, Square } from "lucide-react";
import { LaylaSDK, LaylaError, LaylaAbortError, type LaylaChatMessage } from "../../../src/index";
import { TAROT, type Card } from "./tarrots";

/* ============================================================
   TYPES
   ============================================================ */
type Phase = "idle" | "shuffling" | "dealing" | "spread";
type Sender = "user" | "mystic";
interface Message { from: Sender; text: string; }
interface Drawn { card: Card; revealed: boolean; }
interface ZoomState { card: Card; label: string; }

const SPREAD_LABELS = ["The Past", "The Present", "The Future"];

// 🔮 Madame Selene — kept SHORT so on-device models stay responsive.
const SYSTEM_PROMPT =
  "You are Madame Selene, a warm, theatrical tarot reader. Stay in character and answer briefly (1-3 sentences), mystical but clear. Interpret the seeker's cards and questions.";

// Keep only recent context so the prompt stays small for local models.
const HISTORY_LIMIT = 10;

const layla = new LaylaSDK(); // create once, reuse

/* ============================================================
   SVG ART  —  card face frame, card back, the mystic's portrait
   ============================================================ */
function CardFace({ card }: { card: Card }) {
  return (
    <svg viewBox="0 0 200 320" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <clipPath id={`clip-${card.id}`}>
          <rect x="3" y="3" width="194" height="314" rx="10" />
        </clipPath>
        <radialGradient id={`vig-${card.id}`} cx="50%" cy="44%" r="62%">
          <stop offset="0%" stopColor="#0a0219" stopOpacity="0" />
          <stop offset="52%" stopColor="#0a0219" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#0a0219" stopOpacity="0.93" />
        </radialGradient>
        <linearGradient id={`top-${card.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0219" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#0a0219" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`bot-${card.id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#0a0219" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#0a0219" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* image background + inset dark gradient (edges dark, centre lit) */}
      <g clipPath={`url(#clip-${card.id})`}>
        <image href={card.image} x="3" y="3" width="194" height="314" preserveAspectRatio="xMidYMid slice" />
        <rect x="3" y="3" width="194" height="314" fill={`url(#vig-${card.id})`} />
        <rect x="3" y="3" width="194" height="74" fill={`url(#top-${card.id})`} />
        <rect x="3" y="243" width="194" height="74" fill={`url(#bot-${card.id})`} />
      </g>

      {/* border (kept) */}
      <rect x="7" y="7" width="186" height="306" rx="9" fill="none" stroke="#e9c46a" strokeWidth="1.6" opacity="0.9" />
      <rect x="13" y="13" width="174" height="294" rx="6" fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.7" />
      {[[20, 20], [180, 20], [20, 300], [180, 300]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#e9c46a" opacity="0.85" />
      ))}

      {/* titles top + bottom (kept) */}
      <text x="100" y="46" textAnchor="middle" fill="#e9c46a" fontFamily="Cinzel, serif" fontSize="16" letterSpacing="2" style={{ textShadow: "0 1px 4px #000" }}>{card.numeral}</text>
      <line x1="34" y1="262" x2="166" y2="262" stroke="#e9c46a" strokeWidth="0.8" opacity="0.5" />
      <text x="100" y="286" textAnchor="middle" fill="#f3e8ff" fontFamily="Cinzel, serif" fontSize="14" letterSpacing="1.5">{card.name}</text>
    </svg>
  );
}

function CardBack() {
  return (
    <svg viewBox="0 0 200 320" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="cb-bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#4c1d95" />
          <stop offset="70%" stopColor="#2e1065" />
          <stop offset="100%" stopColor="#16052f" />
        </radialGradient>
      </defs>
      <rect width="200" height="320" rx="12" fill="url(#cb-bg)" />
      <rect x="8" y="8" width="184" height="304" rx="9" fill="none" stroke="#e9c46a" strokeWidth="1.6" />
      <g stroke="#e9c46a" fill="none" strokeWidth="1.1" opacity="0.92">
        {[64, 50, 36, 22].map((r, i) => <circle key={i} cx="100" cy="160" r={r} opacity={0.9 - i * 0.12} />)}
        {[...Array(12)].map((_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={100 + Math.cos(a) * 22} y1={160 + Math.sin(a) * 22} x2={100 + Math.cos(a) * 64} y2={160 + Math.sin(a) * 64} strokeWidth="0.7" />;
        })}
        <circle cx="100" cy="160" r="11" fill="#e9c46a" opacity="0.85" stroke="none" />
        <path d="M100 132 a28 28 0 1 0 0 56 a22 22 0 1 1 0 -56 Z" fill="#2e1065" opacity="0.5" stroke="none" />
      </g>
      {[[100, 30], [100, 290], [34, 160], [166, 160]].map(([x, y], i) => (
        <polygon key={i} points={`${x},${y - 7} ${x + 3},${y} ${x},${y + 7} ${x - 3},${y}`} fill="#e9c46a" opacity="0.8" />
      ))}
    </svg>
  );
}

function MysticAvatar({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
      <defs>
        <radialGradient id="mav" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#2e1065" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#mav)" stroke="#e9c46a" strokeWidth="2" />
      <path d="M50 18 C30 18 26 44 28 70 L72 70 C74 44 70 18 50 18 Z" fill="#1a0b2e" />
      <path d="M50 18 C36 18 30 32 30 48 C40 40 60 40 70 48 C70 32 64 18 50 18 Z" fill="#3b1370" />
      <circle cx="42" cy="52" r="3.4" fill="#e9c46a" />
      <circle cx="58" cy="52" r="3.4" fill="#e9c46a" />
      <circle cx="50" cy="78" r="9" fill="#a855f7" opacity="0.55" />
      <circle cx="50" cy="78" r="9" fill="none" stroke="#e9c46a" strokeWidth="1" />
      <polygon points="50,30 51.5,35 56,35 52,38 53.5,43 50,40 46.5,43 48,38 44,35 48.5,35" fill="#e9c46a" />
    </svg>
  );
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
function Dots() {
  return (
    <>
      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
    </>
  );
}

export default function MysticTarot() {
  const [phase, setPhase] = useState<Phase>("idle"); // idle | shuffling | dealing | spread
  const [drawn, setDrawn] = useState<Drawn[]>([]); // [{card, revealed}]
  const [dealt, setDealt] = useState<boolean>(false);
  const [zoom, setZoom] = useState<ZoomState | null>(null); // {card, label}
  const [messages, setMessages] = useState<Message[]>([
    { from: "mystic", text: "Welcome, seeker. I am Madame Selene. Shuffle the deck when your heart is ready, and let the cards speak. You may also ask me anything." },
  ]);
  const [input, setInput] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState<boolean>(true);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const pendingCtx = useRef<string[]>([]); // card actions to attach to the next message
  const streamRef = useRef<{ abort: () => void } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const apply = () => { setIsMobile(mq.matches); setChatOpen(!mq.matches); };
    apply();
    mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply); };
  }, []);

  const stars = useMemo(
    () => [...Array(70)].map(() => ({
      top: Math.random() * 100, left: Math.random() * 100,
      size: Math.random() * 2 + 0.5, delay: Math.random() * 4, dur: Math.random() * 3 + 2,
    })), []
  );

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, busy]);

  const handleShuffle = () => {
    if (phase === "shuffling" || phase === "dealing") return;
    setZoom(null);
    setDealt(false);
    setDrawn([]);
    pendingCtx.current = []; // fresh spread, drop stale card context
    setChatOpen(false); // tuck the chat away while the cards move
    setPhase("shuffling");
    setTimeout(() => {
      const picks = [...TAROT].sort(() => Math.random() - 0.5).slice(0, 3);
      setDrawn(picks.map((card) => ({ card, revealed: false })));
      setPhase("dealing");
      requestAnimationFrame(() => requestAnimationFrame(() => setDealt(true)));
      setTimeout(() => {
        setPhase("spread");
        if (!isMobile) setChatOpen(true); // bring the panel back on desktop
      }, 900);
    }, 1400);
  };

  const reveal = (i: number) => {
    const d = drawn;
    if (!d[i]) return;
    if (d[i].revealed) { setZoom({ card: d[i].card, label: SPREAD_LABELS[i] }); return; }
    const next = d.map((x, idx) => (idx === i ? { ...x, revealed: true } : x));
    setDrawn(next);
    // Buffer the action; it rides along on the seeker's next message so Selene can react.
    pendingCtx.current.push(`${SPREAD_LABELS[i]}: ${next[i].card.name}`);
  };

  const reset = () => { setPhase("idle"); setDrawn([]); setDealt(false); setZoom(null); };

  const stop = () => streamRef.current?.abort();

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    // Fold any buffered card reveals into a short context tag on this turn only.
    const notes = pendingCtx.current;
    const ctx = notes.length ? `[Seeker just revealed — ${notes.join("; ")}] ` : "";
    pendingCtx.current = [];

    const history = messages.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.from === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const apiMessages: LaylaChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history as LaylaChatMessage[]),
      { role: "user", content: ctx + text },
    ];

    // Show the clean user message + an empty bubble that fills as tokens stream in.
    setMessages((m) => [...m, { from: "user", text }, { from: "mystic", text: "" }]);
    setInput("");
    setBusy(true);

    try {
      const stream = layla.chat.completions.stream({ messages: apiMessages });
      streamRef.current = stream;
      stream.on("content", (_delta: string, snapshot: string) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { from: "mystic", text: snapshot };
          return copy;
        });
      });
      await stream.finalContent();
    } catch (e) {
      if (!(e instanceof LaylaAbortError)) {
        const msg = e instanceof LaylaError ? e.message : "the connection to the spirits wavered";
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { from: "mystic", text: `…the vision clouds — ${msg}.` };
          return copy;
        });
      }
    } finally {
      streamRef.current = null;
      setBusy(false);
      // Drop a trailing empty bubble (e.g. aborted before any token arrived).
      setMessages((m) =>
        m.length && m[m.length - 1].from === "mystic" && m[m.length - 1].text === ""
          ? m.slice(0, -1)
          : m
      );
    }
  };

  const spreadGap = isMobile ? 92 : 190;
  const spreadRot = isMobile ? 6 : 9;
  const cardW = isMobile ? 116 : 150;
  const cardH = isMobile ? 186 : 240;
  const positions = [
    { x: -spreadGap, rot: -spreadRot },
    { x: 0, rot: 0 },
    { x: spreadGap, rot: spreadRot },
  ];

  const animating = phase === "shuffling" || phase === "dealing";
  const lastMystic = [...messages].reverse().find((m) => m.from === "mystic");
  // Float the mystic's words over the table whenever the chat panel is tucked away.
  const showFloating = !chatOpen && !!lastMystic && !animating;

  const chatInner = (
    <>
      <div style={styles.chatHead}>
        <MysticAvatar size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 14, color: "#f3e8ff" }}>Speak with Selene</div>
          <div style={{ fontSize: 11, color: "#22c55e", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={styles.dot} /> Attuned to your spirit
          </div>
        </div>
        <button onClick={() => setChatOpen(false)} style={styles.chatCloseBtn} aria-label="Collapse chat">
          {isMobile ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      <div ref={chatRef} style={styles.chatBody}>
        {messages.map((m, i) => (
          <div key={i} style={{ ...styles.msgRow, justifyContent: m.from === "user" ? "flex-end" : "flex-start" }}>
            {m.from === "mystic" && <div style={styles.msgAvatar}><MysticAvatar size={28} /></div>}
            <div className="msg-bubble" style={m.from === "user" ? styles.userBubble : styles.mysticBubble}>
              {m.text === "" ? <Dots /> : m.text}
            </div>
          </div>
        ))}
      </div>

      <div style={styles.chatInputRow}>
        <input
          value={input}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && send()}
          placeholder={pendingCtx.current.length ? "Ask Selene about your cards…" : "Ask the mystic…"}
          style={styles.input}
        />
        {busy ? (
          <button onClick={stop} style={styles.sendBtn} aria-label="Stop"><Square size={15} /></button>
        ) : (
          <button onClick={send} style={styles.sendBtn} aria-label="Send"><Send size={16} /></button>
        )}
      </div>
    </>
  );

  return (
    <div style={styles.root}>
      <style>{CSS}</style>

      {/* starfield */}
      <div style={styles.stars}>
        {stars.map((s, i) => (
          <span key={i} style={{
            position: "absolute", top: `${s.top}%`, left: `${s.left}%`,
            width: s.size, height: s.size, borderRadius: "50%", background: "#fff",
            boxShadow: "0 0 6px #d8b4fe", animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }} />
        ))}
      </div>
      <div style={styles.fog} />

      {/* header */}
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ animation: "floatY 5s ease-in-out infinite" }}><MysticAvatar size={52} /></div>
          <div>
            <div style={styles.brand}>Madame Selene</div>
            <div style={styles.sub}><Stars size={12} /> Reader of the Veiled Path</div>
          </div>
        </div>
        <div style={styles.moonBadge}><Moon size={16} /> Waxing Crescent</div>
      </header>

      <main style={styles.main}>
        {/* ---------- STAGE ---------- */}
        <section style={styles.stage}>
          <h1 style={styles.title}>The Three-Card Spread</h1>
          <p style={styles.hint}>
            {phase === "idle" && "Center yourself, then shuffle the deck."}
            {phase === "shuffling" && "Shuffling the fates…"}
            {phase === "dealing" && "Dealing your destiny…"}
            {phase === "spread" && (drawn.every((d) => d.revealed) ? "Tap a card to gaze deeper." : "Tap each card to reveal it.")}
          </p>

          <div style={styles.tableWrap}>
            {/* idle / shuffling deck */}
            {(phase === "idle" || phase === "shuffling") && (
              <div style={{ ...styles.deck, width: cardW, height: cardH }} className={phase === "shuffling" ? "shuffling" : ""}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="deck-card" style={{
                    ...styles.deckCard, width: cardW, height: cardH,
                    transform: `translate(-50%,-50%) translate(${(i - 2.5) * 1.5}px, ${(i - 2.5) * 1.5}px)`,
                    zIndex: i, ["--dir"]: i % 2 === 0 ? 1 : -1, animationDelay: `${i * 0.05}s`,
                  } as React.CSSProperties}>
                    <CardBack />
                  </div>
                ))}
                <div style={{ ...styles.deckGlow, animation: "glowPulse 3s ease-in-out infinite" }} />
              </div>
            )}

            {/* spread */}
            {(phase === "dealing" || phase === "spread") && (
              <div style={styles.spread}>
                {drawn.map((d, i) => {
                  const p = positions[i];
                  const target = dealt
                    ? `translate(-50%,-50%) translateX(${p.x}px) rotate(${p.rot}deg)`
                    : `translate(-50%,-50%) translateX(0px) rotate(0deg) scale(0.9)`;
                  return (
                    <div key={d.card.id} className="spread-card" style={{
                      ...styles.spreadCard, width: cardW, height: cardH, transform: target,
                      transitionDelay: `${i * 0.12}s`, zIndex: dealt ? 1 : 6 - i,
                    }} onClick={() => reveal(i)}>
                      <div style={styles.cardLabel}>{SPREAD_LABELS[i]}</div>
                      <div className="flip" style={styles.flip}>
                        <div className="flip-inner" style={{
                          ...styles.flipInner,
                          transform: d.revealed ? "rotateY(180deg)" : "rotateY(0deg)",
                        }}>
                          <div style={{ ...styles.face, ...styles.faceFront }}><CardBack /></div>
                          <div style={{ ...styles.face, ...styles.faceBack }}><CardFace card={d.card} /></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* when the chat is tucked away, just a tap target — no overlapping text */}
            {showFloating && (
              <div style={styles.floatLayer} onClick={() => setChatOpen(true)}>
                <div className="float-in" style={styles.floatTap}><MessageCircle size={12} /> tap to reply</div>
              </div>
            )}
          </div>

          <div style={styles.controls}>
            <button onClick={handleShuffle} disabled={animating} style={styles.primaryBtn}>
              <Shuffle size={16} /> {phase === "idle" ? "Shuffle & Draw" : "Shuffle Again"}
            </button>
            {phase === "spread" && (
              <button onClick={reset} style={styles.ghostBtn}><RotateCcw size={15} /> New Reading</button>
            )}
          </div>
        </section>

        {/* ---------- CHAT (desktop docked column, collapses during animations) ---------- */}
        {!isMobile && (
          <aside style={{ ...styles.chatCol, ...(chatOpen ? styles.chatColOpen : styles.chatColClosed) }}>
            <div style={styles.chatInnerWrap}>{chatInner}</div>
          </aside>
        )}
      </main>

      {/* ---------- CHAT (mobile bottom sheet) ---------- */}
      {isMobile && (
        <div style={{ ...styles.sheet, transform: chatOpen ? "translateY(0)" : "translateY(112%)" }}>
          {chatInner}
        </div>
      )}

      {/* ---------- reopen button (only while chat is closed, so it never covers Send) ---------- */}
      {!chatOpen && (
        <button onClick={() => setChatOpen(true)} style={styles.fab} aria-label="Open chat">
          <MessageCircle size={22} />
          <span style={styles.fabPing} />
        </button>
      )}

      {/* ---------- ZOOM MODAL ---------- */}
      {zoom && (
        <div style={styles.overlay} onClick={() => setZoom(null)}>
          <div style={styles.zoomWrap} onClick={(e) => e.stopPropagation()}>
            <div className="zoom-card" style={styles.zoomCard}><CardFace card={zoom.card} /></div>
            <div className="zoom-text" style={styles.zoomText}>
              <div style={styles.zoomLabel}><Eye size={13} /> {zoom.label}</div>
              <div style={styles.zoomName}>{zoom.card.name}</div>
              <div style={styles.zoomNum}>{zoom.card.numeral}</div>
              <div style={styles.zoomKw}>{zoom.card.keywords}</div>
              <p style={styles.zoomMeaning}>{zoom.card.meaning}</p>
              <button onClick={() => setZoom(null)} style={styles.ghostBtn}><Sparkles size={14} /> Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const GOLD = "#e9c46a", LAV = "#e9d5ff";

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "relative", height: "100vh", minHeight: "100vh", width: "100%", overflow: "hidden",
    display: "flex", flexDirection: "column",
    background: "radial-gradient(circle at 50% 0%, #3b1370 0%, #1a0738 45%, #0c0220 100%)",
    color: LAV, fontFamily: "'Cormorant Garamond', Georgia, serif",
  },
  stars: { position: "absolute", inset: 0, pointerEvents: "none" },
  fog: {
    position: "absolute", inset: 0, pointerEvents: "none",
    background: "radial-gradient(ellipse at 50% 120%, rgba(168,85,247,0.25), transparent 60%)",
  },
  header: {
    position: "relative", zIndex: 2, display: "flex", justifyContent: "space-between",
    alignItems: "center", padding: "16px 20px", borderBottom: "1px solid rgba(233,196,106,0.18)",
    flexWrap: "wrap", gap: 10,
  },
  brand: { fontFamily: "'Cinzel Decorative', serif", fontSize: 22, color: "#fff", letterSpacing: 1, textShadow: "0 0 18px rgba(168,85,247,0.7)" },
  sub: { fontSize: 13, color: GOLD, display: "flex", alignItems: "center", gap: 5, letterSpacing: 1 },
  moonBadge: {
    display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: LAV,
    border: "1px solid rgba(233,196,106,0.35)", borderRadius: 30, padding: "6px 14px",
    background: "rgba(124,58,237,0.18)", letterSpacing: 0.5,
  },
  main: { position: "relative", zIndex: 2, flex: 1, minHeight: 0, display: "flex", gap: 20, padding: 20, flexWrap: "wrap", alignItems: "stretch" },
  stage: {
    flex: "1 1 560px", minWidth: 340, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center",
    padding: "10px 10px 24px", borderRadius: 18, border: "1px solid rgba(233,196,106,0.16)",
    background: "linear-gradient(180deg, rgba(46,16,101,0.35), rgba(12,2,32,0.25))",
  },
  title: { fontFamily: "'Cinzel Decorative', serif", fontSize: 26, color: "#fff", margin: "10px 0 2px", letterSpacing: 1, textAlign: "center" },
  hint: { fontSize: 16, color: GOLD, margin: "0 0 8px", minHeight: 22, fontStyle: "italic" },
  tableWrap: {
    position: "relative", width: "100%", flex: 1, minHeight: 260, display: "flex",
    alignItems: "center", justifyContent: "center", perspective: 1400,
  },
  deck: { position: "relative", width: 150, height: 240 },
  deckCard: {
    position: "absolute", top: "50%", left: "50%", width: 150, height: 240,
    borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.55)", overflow: "hidden",
  },
  deckGlow: {
    position: "absolute", top: "50%", left: "50%", width: 200, height: 290,
    transform: "translate(-50%,-50%)", borderRadius: 20, zIndex: -1,
    background: "radial-gradient(circle, rgba(168,85,247,0.5), transparent 70%)",
  },
  spread: { position: "relative", width: "100%", height: "100%" },
  spreadCard: {
    position: "absolute", top: "50%", left: "50%", width: 150, height: 240, cursor: "pointer",
    transition: "transform 0.85s cubic-bezier(.18,.9,.32,1.2)",
  },
  cardLabel: {
    position: "absolute", top: -26, left: 0, width: "100%", textAlign: "center",
    fontSize: 13, color: GOLD, letterSpacing: 1.5, fontFamily: "'Cinzel', serif", textTransform: "uppercase",
  },
  flip: { width: "100%", height: "100%", perspective: 1000 },
  flipInner: { position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transition: "transform 0.8s cubic-bezier(.4,.2,.2,1)" },
  face: { position: "absolute", inset: 0, borderRadius: 12, overflow: "hidden", backfaceVisibility: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.6)" },
  faceFront: {},
  faceBack: { transform: "rotateY(180deg)" },
  controls: { display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap", justifyContent: "center" },
  primaryBtn: {
    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
    background: "linear-gradient(135deg, #a855f7, #6d28d9)", color: "#fff",
    border: "1px solid rgba(233,196,106,0.6)", borderRadius: 30, padding: "11px 24px",
    fontSize: 16, fontFamily: "'Cinzel', serif", letterSpacing: 1, boxShadow: "0 6px 24px rgba(124,58,237,0.6)",
  },
  ghostBtn: {
    display: "flex", alignItems: "center", gap: 7, cursor: "pointer", background: "transparent",
    color: GOLD, border: "1px solid rgba(233,196,106,0.5)", borderRadius: 30, padding: "10px 20px",
    fontSize: 15, fontFamily: "'Cinzel', serif", letterSpacing: 1,
  },
  // desktop docked chat column that collapses during animations
  chatCol: {
    display: "flex", overflow: "hidden", alignSelf: "stretch",
    transition: "flex-basis 0.5s cubic-bezier(.4,.1,.2,1), opacity 0.4s ease, transform 0.5s ease, margin 0.5s ease",
  },
  chatColOpen: { flex: "1 1 360px", maxWidth: 440, minWidth: 320, opacity: 1, transform: "translateX(0)" },
  chatColClosed: { flexBasis: 0, minWidth: 0, maxWidth: 0, opacity: 0, transform: "translateX(40px)", marginLeft: -20 },
  chatInnerWrap: {
    width: "100%", minWidth: 320, display: "flex", flexDirection: "column", minHeight: 480, alignSelf: "stretch",
    borderRadius: 18, overflow: "hidden", border: "1px solid rgba(233,196,106,0.2)",
    background: "linear-gradient(180deg, rgba(46,16,101,0.55), rgba(12,2,32,0.6))", backdropFilter: "blur(6px)",
  },
  // mobile bottom sheet
  sheet: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, height: "72vh", maxHeight: 560,
    display: "flex", flexDirection: "column", borderRadius: "22px 22px 0 0",
    border: "1px solid rgba(233,196,106,0.3)", borderBottom: "none",
    background: "linear-gradient(180deg, rgba(46,16,101,0.92), rgba(12,2,32,0.96))",
    backdropFilter: "blur(12px)", boxShadow: "0 -16px 50px rgba(0,0,0,0.6)",
    transition: "transform 0.45s cubic-bezier(.4,.1,.2,1)",
  },
  fab: {
    position: "fixed", right: 18, bottom: 18, zIndex: 45, width: 56, height: 56, borderRadius: "50%",
    border: "1px solid rgba(233,196,106,0.7)", cursor: "pointer", color: "#fff",
    background: "linear-gradient(135deg, #a855f7, #6d28d9)", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 8px 28px rgba(124,58,237,0.7)", animation: "floatY 4s ease-in-out infinite",
  },
  fabPing: {
    position: "absolute", top: 10, right: 10, width: 10, height: 10, borderRadius: "50%",
    background: GOLD, boxShadow: "0 0 10px " + GOLD, animation: "pingDot 1.6s ease-out infinite",
  },
  chatCloseBtn: {
    background: "transparent", border: "none", color: GOLD, cursor: "pointer", padding: 4,
    display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8,
  },
  // floating mystic words over the table — borderless
  floatLayer: {
    position: "absolute", left: 0, right: 0, bottom: 6, zIndex: 8, display: "flex",
    flexDirection: "column", alignItems: "center", gap: 6, padding: "0 14px", cursor: "pointer", pointerEvents: "auto",
  },
  floatBubble: {
    display: "flex", alignItems: "flex-start", gap: 10, maxWidth: 460, padding: "10px 4px",
    color: "#f6ecff", fontSize: 17, lineHeight: 1.5, fontStyle: "italic", textAlign: "left",
    textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 0 22px rgba(124,58,237,0.6)",
    background: "radial-gradient(ellipse at center, rgba(20,5,40,0.55), transparent 75%)",
  },
  floatTap: {
    display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: GOLD, letterSpacing: 1,
    textTransform: "uppercase", opacity: 0.85, textShadow: "0 1px 6px #000",
  },
  chatHead: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(233,196,106,0.18)", background: "rgba(124,58,237,0.18)" },
  dot: { width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 8px #22c55e" },
  chatBody: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  msgRow: { display: "flex", gap: 8, alignItems: "flex-end" },
  msgAvatar: { flexShrink: 0 },
  mysticBubble: {
    maxWidth: "82%", background: "rgba(124,58,237,0.32)", border: "none",
    color: "#f3e8ff", padding: "10px 14px", borderRadius: "4px 16px 16px 16px", fontSize: 16, lineHeight: 1.45,
    animation: "slideUp 0.4s ease both", boxShadow: "0 4px 18px rgba(76,29,149,0.45)", backdropFilter: "blur(2px)",
  },
  userBubble: {
    maxWidth: "82%", background: "linear-gradient(135deg, #7c3aed, #4c1d95)", color: "#fff", border: "none",
    padding: "10px 14px", borderRadius: "16px 4px 16px 16px", fontSize: 16, lineHeight: 1.45,
    animation: "slideUp 0.4s ease both", boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  },
  chatInputRow: { display: "flex", gap: 8, padding: 12, borderTop: "1px solid rgba(233,196,106,0.18)" },
  input: {
    flex: 1, background: "rgba(12,2,32,0.6)", border: "1px solid rgba(233,196,106,0.3)", borderRadius: 24,
    padding: "11px 16px", color: LAV, fontSize: 16, fontFamily: "'Cormorant Garamond', serif", outline: "none",
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(233,196,106,0.6)", cursor: "pointer",
    background: "linear-gradient(135deg, #a855f7, #6d28d9)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
  },
  overlay: {
    position: "fixed", inset: 0, zIndex: 50, background: "rgba(8,2,20,0.82)",
    backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20, animation: "fadeIn 0.3s ease", cursor: "pointer", overflowY: "auto",
  },
  zoomWrap: {
    display: "flex", gap: 30, alignItems: "center", flexWrap: "wrap", justifyContent: "center",
    cursor: "default", maxWidth: 720, maxHeight: "calc(100vh - 40px)", overflowY: "auto",
    margin: "auto", padding: 4, WebkitOverflowScrolling: "touch",
  },
  zoomCard: {
    width: 250, height: 400, borderRadius: 16, overflow: "hidden", flexShrink: 0,
    boxShadow: "0 0 60px rgba(168,85,247,0.7)", animation: "zoomPop 0.5s cubic-bezier(.18,.9,.32,1.2) both",
  },
  zoomText: { maxWidth: 360, animation: "slideUp 0.5s 0.15s ease both" },
  zoomLabel: { display: "inline-flex", alignItems: "center", gap: 6, color: GOLD, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Cinzel', serif" },
  zoomName: { fontFamily: "'Cinzel Decorative', serif", fontSize: 32, color: "#fff", margin: "6px 0 0", textShadow: "0 0 20px rgba(168,85,247,0.8)" },
  zoomNum: { color: GOLD, fontSize: 16, letterSpacing: 3, marginBottom: 8 },
  zoomKw: { color: "#d8b4fe", fontSize: 17, fontStyle: "italic", marginBottom: 14 },
  zoomMeaning: { fontSize: 18, lineHeight: 1.6, color: "#f3e8ff", marginBottom: 20 },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Cinzel+Decorative:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&display=swap');
* { box-sizing: border-box; }
@keyframes twinkle { 0%,100% { opacity: 0.15; } 50% { opacity: 1; } }
@keyframes floatY { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes glowPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.9; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes zoomPop { from { opacity: 0; transform: scale(0.5) rotate(-6deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes pingDot { 0% { transform: scale(0.6); opacity: 0.9; } 70%,100% { transform: scale(1.8); opacity: 0; } }
@keyframes floatIn { from { opacity: 0; transform: translateY(16px); filter: blur(4px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
.float-in { animation: floatIn 0.6s cubic-bezier(.18,.9,.32,1.1) both; }
@keyframes shuffle {
  0%   { transform: translate(-50%,-50%) translate(var(--ox,0), var(--oy,0)) rotate(0); }
  20%  { transform: translate(-50%,-50%) translate(calc(var(--dir) * 90px), -14px) rotate(calc(var(--dir) * 10deg)); }
  45%  { transform: translate(-50%,-50%) translate(calc(var(--dir) * -55px), 10px) rotate(calc(var(--dir) * -7deg)); }
  70%  { transform: translate(-50%,-50%) translate(calc(var(--dir) * 30px), -4px) rotate(calc(var(--dir) * 4deg)); }
  100% { transform: translate(-50%,-50%) rotate(0); }
}
.shuffling .deck-card { animation: shuffle 0.7s ease-in-out 2; }
.spread-card:hover { z-index: 9 !important; }
.spread-card:hover .flip-inner { box-shadow: 0 0 36px rgba(168,85,247,0.7); border-radius: 12px; }
.msg-bubble { word-break: break-word; }
.typing-dot { display:inline-block; width:7px; height:7px; margin:0 2px; border-radius:50%; background:#e9c46a; animation: floatY 0.9s ease-in-out infinite; }
.typing-dot:nth-child(2){ animation-delay:0.15s; } .typing-dot:nth-child(3){ animation-delay:0.3s; }
input::placeholder { color: rgba(233,213,255,0.45); font-style: italic; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.5); border-radius: 8px; }
`;