import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";

export interface UciMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface MoveRequest {
  fen: string;
  skill: number; // 0..20
  moveTimeMs: number;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const CENTER = new Set(["d4", "e4", "d5", "e5"]);
const NEAR_CENTER = new Set(["c3", "c4", "c5", "c6", "d3", "d6", "e3", "e6", "f3", "f4", "f5", "f6"]);

/** A small, dependency-free engine used when Stockfish isn't loaded.
 *  Scores moves by material, simple positional bonuses and a one-ply
 *  hanging-piece check, then adds skill-scaled randomness. */
function fallbackBestMove({ fen, skill }: MoveRequest): UciMove | null {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  const noise = (20 - Math.max(0, Math.min(20, skill))) / 20; // 0 (best) .. 1 (random)
  const safety = 1 - noise; // how much it avoids hanging pieces

  let best: { move: (typeof moves)[number]; score: number } | null = null;

  for (const m of moves) {
    let score = 0;
    if (m.captured) score += PIECE_VALUE[m.captured] * 10;
    if (m.promotion) score += PIECE_VALUE[m.promotion] * 10;
    if (CENTER.has(m.to)) score += 3;
    else if (NEAR_CENTER.has(m.to)) score += 1;
    if (m.piece !== "p" && m.piece !== "k" && /^[a-h][12]$/.test(m.from)) score += 1; // develop

    game.move(m);
    if (game.isCheckmate()) score += 100000;
    else if (game.isCheck()) score += 4;

    // One-ply look: what can the opponent capture next?
    let worstReply = 0;
    for (const reply of game.moves({ verbose: true })) {
      if (reply.captured) worstReply = Math.max(worstReply, PIECE_VALUE[reply.captured] * 10);
    }
    score -= worstReply * safety;
    game.undo();

    score += Math.random() * 40 * noise;

    if (!best || score > best.score) best = { move: m, score };
  }

  if (!best) return null;
  return { from: best.move.from, to: best.move.to, promotion: best.move.promotion };
}

type EngineKind = "stockfish" | "builtin";

export function useChessEngine(workerUrl = "/stockfish.js") {
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const [kind, setKind] = useState<EngineKind>("builtin");
  const [thinking, setThinking] = useState(false);

  // Tracks the in-flight Stockfish search so messages resolve the right promise.
  const pending = useRef<{ resolve: (m: UciMove | null) => void } | null>(null);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(workerUrl);
      const onMessage = (e: MessageEvent) => {
        const line: string = typeof e.data === "string" ? e.data : (e.data?.data ?? "");
        if (line.includes("uciok")) {
          worker?.postMessage("isready");
        } else if (line.includes("readyok")) {
          readyRef.current = true;
          setKind("stockfish");
        } else if (line.startsWith("bestmove")) {
          const token = line.split(/\s+/)[1];
          const cb = pending.current;
          pending.current = null;
          if (!token || token === "(none)") {
            cb?.resolve(null);
          } else {
            cb?.resolve({
              from: token.slice(0, 2),
              to: token.slice(2, 4),
              promotion: token.length > 4 ? token.slice(4, 5) : undefined,
            });
          }
        }
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", () => {
        // Engine file missing/broken — silently use the built-in fallback.
        readyRef.current = false;
        setKind("builtin");
      });
      worker.postMessage("uci");
      workerRef.current = worker;
    } catch {
      // Worker construction failed (e.g. no file). Built-in engine takes over.
      readyRef.current = false;
      queueMicrotask(() => setKind("builtin"));
    }

    return () => {
      worker?.terminate();
      workerRef.current = null;
      readyRef.current = false;
    };
  }, [workerUrl]);

  const getBestMove = useCallback(async (req: MoveRequest): Promise<UciMove | null> => {
    setThinking(true);
    try {
      const worker = workerRef.current;
      if (worker && readyRef.current) {
        const move = await new Promise<UciMove | null>((resolve) => {
          pending.current = { resolve };
          worker.postMessage("ucinewgame");
          worker.postMessage(`setoption name Skill Level value ${Math.round(req.skill)}`);
          worker.postMessage(`position fen ${req.fen}`);
          worker.postMessage(`go movetime ${req.moveTimeMs}`);
          // Safety net so a stuck engine never freezes the UI.
          setTimeout(() => {
            if (pending.current?.resolve === resolve) {
              pending.current = null;
              resolve(fallbackBestMove(req));
            }
          }, req.moveTimeMs + 2500);
        });
        return move;
      }

      // Built-in engine: a touch of latency so it feels like it's thinking.
      await new Promise((r) => setTimeout(r, Math.min(700, 250 + req.moveTimeMs * 0.3)));
      return fallbackBestMove(req);
    } finally {
      setThinking(false);
    }
  }, []);

  return { getBestMove, engineKind: kind, thinking };
}
