import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Difficulty, PlayerColor } from "../types";
import type { UciMove } from "../engine/useChessEngine";

export type GameStatus = "playing" | "checkmate" | "stalemate" | "draw";
export type GameEventKind =
  | "start"
  | "player-move"
  | "engine-move"
  | "check"
  | "player-win"
  | "player-lose"
  | "draw";

export interface GameEvent {
  kind: GameEventKind;
  /** Increments every event so listeners can react even to repeats. */
  seq: number;
  fen: string;
  history: string[];
  move?: GameMoveFacts;
}

export interface GameMoveFacts {
  by: "player" | "engine";
  san: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  isCapture: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isKingsideCastle: boolean;
  isQueensideCastle: boolean;
  isPromotion: boolean;
  isEnPassant: boolean;
}

interface Params {
  playerColor: PlayerColor;
  difficulty: Difficulty;
  getBestMove: (req: { fen: string; skill: number; moveTimeMs: number }) => Promise<UciMove | null>;
}

const colorChar = (c: PlayerColor) => (c === "white" ? "w" : "b");
const START_FEN = new Chess().fen();

export function useChessGame({ playerColor, difficulty, getBestMove }: Params) {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(START_FEN);
  const [status, setStatus] = useState<GameStatus>("playing");
  const [resigned, setResigned] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [event, setEvent] = useState<GameEvent>({
    kind: "start",
    seq: 0,
    fen: START_FEN,
    history: [],
  });
  const [engineThinking, setEngineThinking] = useState(false);

  const seqRef = useRef(0);
  const engineBusy = useRef(false);

  const me = colorChar(playerColor);
  const turn = fen.split(" ")[1] as "w" | "b";
  const isPlayerTurn = turn === me && status === "playing" && !resigned;

  const toMoveFacts = useCallback(
    (move: ReturnType<Chess["move"]>, by: GameMoveFacts["by"]): GameMoveFacts => ({
      by,
      san: move.san,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      isCapture: move.flags.includes("c") || move.flags.includes("e"),
      isCheck: move.san.includes("+") || move.san.includes("#"),
      isCheckmate: move.san.includes("#"),
      isKingsideCastle: move.flags.includes("k"),
      isQueensideCastle: move.flags.includes("q"),
      isPromotion: move.flags.includes("p"),
      isEnPassant: move.flags.includes("e"),
    }),
    []
  );

  const emit = useCallback((kind: GameEventKind, move?: GameMoveFacts) => {
    seqRef.current += 1;
    const g = gameRef.current;
    setEvent({ kind, seq: seqRef.current, fen: g.fen(), history: g.history(), move });
  }, []);

  const sync = useCallback(() => {
    const g = gameRef.current;
    setFen(g.fen());
    setHistory(g.history());
  }, []);

  const evaluateEnd = useCallback((): GameStatus => {
    const g = gameRef.current;
    if (g.isCheckmate()) return "checkmate";
    if (g.isStalemate()) return "stalemate";
    if (g.isDraw() || g.isThreefoldRepetition() || g.isInsufficientMaterial()) return "draw";
    return "playing";
  }, []);

  const announceAfterMove = useCallback(
    (moverWasPlayer: boolean, move: GameMoveFacts) => {
      const g = gameRef.current;
      const end = evaluateEnd();
      if (end !== "playing") {
        setStatus(end);
        if (end === "checkmate") {
          // The side just mated is the side NOT to move now.
          emit(moverWasPlayer ? "player-win" : "player-lose", move);
        } else {
          emit("draw", move);
        }
        return;
      }
      if (g.isCheck()) emit("check", move);
      else emit(moverWasPlayer ? "player-move" : "engine-move", move);
    },
    [emit, evaluateEnd]
  );

  /** Attempt a player move. Returns true if it was legal and applied. */
  const tryPlayerMove = useCallback(
    (from: string, to: string): boolean => {
      if (!isPlayerTurn) return false;
      const g = gameRef.current;
      try {
        const moved = g.move({ from, to, promotion: "q" }); // auto-queen for now
        if (!moved) return false;
        const moveFacts = toMoveFacts(moved, "player");
        setLastMove({ from, to });
        setSelected(null);
        sync();
        announceAfterMove(true, moveFacts);
        return true;
      } catch {
        return false; // chess.js throws on illegal moves
      }
    },
    [isPlayerTurn, sync, announceAfterMove, toMoveFacts]
  );

  // Engine replies whenever it's its turn.
  useEffect(() => {
    if (status !== "playing" || resigned) return;
    if (turn === me) return;
    if (engineBusy.current) return;

    engineBusy.current = true;
    setEngineThinking(true);
    let cancelled = false;

    (async () => {
      const g = gameRef.current;
      const move = await getBestMove({
        fen: g.fen(),
        skill: difficulty.skill,
        moveTimeMs: difficulty.moveTimeMs,
      });
      if (cancelled) return;
      if (move) {
        try {
          const moved = g.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
          if (!moved) return;
          const moveFacts = toMoveFacts(moved, "engine");
          setLastMove({ from: move.from, to: move.to });
          sync();
          announceAfterMove(false, moveFacts);
        } catch {
          /* ignore an engine move that somehow doesn't apply */
        }
      }
      engineBusy.current = false;
      setEngineThinking(false);
    })();

    return () => {
      cancelled = true;
      engineBusy.current = false;
      setEngineThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, status, resigned, me, difficulty.skill, difficulty.moveTimeMs]);

  // Click-to-move: legal destinations for the currently selected square.
  const legalTargets = useMemo(() => {
    if (!selected) return [] as string[];
    return new Chess(fen)
      .moves({ square: selected as never, verbose: true })
      .map((m) => m.to);
  }, [selected, fen]);

  const onSquareClick = useCallback(
    (square: string) => {
      if (!isPlayerTurn) return;
      const g = gameRef.current;
      if (selected && legalTargets.includes(square)) {
        tryPlayerMove(selected, square);
        return;
      }
      const piece = g.get(square as never);
      if (piece && piece.color === me) setSelected(square);
      else setSelected(null);
    },
    [isPlayerTurn, selected, legalTargets, tryPlayerMove, me]
  );

  const newGame = useCallback(() => {
    gameRef.current = new Chess();
    engineBusy.current = false;
    setResigned(false);
    setStatus("playing");
    setLastMove(null);
    setSelected(null);
    setHistory([]);
    setFen(gameRef.current.fen());
    emit("start");
  }, [emit]);

  const resign = useCallback(() => {
    if (status !== "playing") return;
    setResigned(true);
    setStatus("checkmate");
    emit("player-lose");
  }, [status, emit]);

  const inCheck = new Chess(fen).isCheck() && status === "playing";

  return {
    fen,
    turn,
    status,
    resigned,
    isPlayerTurn,
    engineThinking,
    lastMove,
    selected,
    legalTargets,
    history,
    inCheck,
    event,
    tryPlayerMove,
    onSquareClick,
    newGame,
    resign,
  };
}
