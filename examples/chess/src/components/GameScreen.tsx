import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { motion } from "framer-motion";
import type { ChatMessage, GameConfig } from "../types";
import { layla } from "../laylaClient";
import { useChessEngine } from "../engine/useChessEngine";
import { useChessGame } from "../hooks/useChessGame";
import {
  buildCommentaryMessages,
  buildCommentaryPayload,
  shouldRequestCommentary,
  type CommentaryReason,
} from "../chessCommentary";
import { Avatar } from "./Avatar";
import { SpeechBubble } from "./SpeechBubble";
import { ChatDrawer } from "./ChatDrawer";
import styles from "./GameScreen.module.css";
import { LaylaAbortError } from "../layla";
import { formatLaylaConnectionError } from "../laylaErrors";

interface Props {
  config: GameConfig;
  onExit: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function GameScreen({ config, onExit }: Props) {
  const { character, playerColor, difficulty } = config;
  const me = playerColor === "white" ? "w" : "b";

  const { getBestMove, engineKind, thinking: engineLoading } = useChessEngine();
  const game = useChessGame({ playerColor, difficulty, getBestMove });

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(
    character.greeting
      ? [{ id: uid(), role: "character", text: character.greeting, at: 0 }]
      : [],
  );
  const [replying, setReplying] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const messagesRef = useRef(messages);
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const requestRef = useRef(0);
  const replyingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const latestCharacterMessage = useMemo(
    () => messages.findLast((message) => message.role === "character") ?? null,
    [messages],
  );
  const shownBubble = latestCharacterMessage?.text ?? "";
  const bubbleCue = latestCharacterMessage?.at ?? 0;
  const waitingForCharacterReply =
    replying && latestCharacterMessage?.role === "character" && !shownBubble.trim();

  const requestCommentary = useCallback(
    async (params: {
      reason: CommentaryReason;
      instruction: string;
      userText?: string;
      sourceMessages?: ChatMessage[];
      force?: boolean;
    }) => {
      if (replyingRef.current && !params.force) return;
      if (params.force) streamRef.current?.abort();

      const requestId = requestRef.current + 1;
      const eventForRequest = game.event;
      requestRef.current = requestId;
      replyingRef.current = true;
      setReplying(true);
      setConnectionError(null);

      const replyId = uid();
      const seedMessages = params.sourceMessages ?? messagesRef.current;
      const payload = buildCommentaryPayload({
        reason: params.reason,
        instruction: params.instruction,
        event: eventForRequest,
        fen: eventForRequest.fen || game.fen,
        playerColor,
        messages: seedMessages,
      });
      const llmMessages = buildCommentaryMessages({
        character,
        payload,
        userText: params.userText,
      });

      setMessages((prev) => [...prev, { id: replyId, role: "character", text: "", at: Date.now() }]);

      try {
        const stream = layla.chat.completions.stream({ messages: llmMessages });
        streamRef.current = stream;

        stream.on("content", (_delta, snapshot) => {
          if (requestRef.current !== requestId) return;
          const text = snapshot.trimStart();
          setMessages((prev) =>
            prev.map((message) => (message.id === replyId ? { ...message, text } : message))
          );
        });

        const finalText = (await stream.finalContent()).trim();
        if (requestRef.current !== requestId) return;
        if (finalText) {
          setMessages((prev) =>
            prev.map((message) => (message.id === replyId ? { ...message, text: finalText } : message))
          );
        } else {
          setMessages((prev) => prev.filter((message) => message.id !== replyId));
        }
      } catch (error) {
        if (error instanceof LaylaAbortError) {
          setMessages((prev) =>
            prev.filter((message) => message.id !== replyId || message.text.trim())
          );
          return;
        }
        console.error("Layla commentary failed:", error);
        if (requestRef.current !== requestId) return;
        setConnectionError(formatLaylaConnectionError(error));
        setMessages((prev) => prev.filter((message) => message.id !== replyId));
      } finally {
        if (requestRef.current === requestId) {
          streamRef.current = null;
          replyingRef.current = false;
          setReplying(false);
        }
      }
    },
    [character, game.event, game.fen, playerColor]
  );

  useEffect(() => {
    if (!shouldRequestCommentary(game.event)) return;

    const reason: CommentaryReason =
      game.event.kind === "player-win" || game.event.kind === "player-lose" || game.event.kind === "draw"
        ? "game_over"
        : game.event.kind === "check"
          ? "check"
          : game.event.move?.by === "engine"
            ? "character_move"
            : "player_move";

    const instruction =
      reason === "game_over"
        ? "React to the result of the game."
        : reason === "character_move"
          ? "Say a short line after your own chess move."
          : "React to the human player's latest chess move.";

    void requestCommentary({ reason, instruction });
  }, [game.event.seq, game.event, requestCommentary]);

  const handleSend = (text: string) => {
    const playerMessage: ChatMessage = { id: uid(), role: "player", text, at: Date.now() };
    const nextMessages = [...messagesRef.current, playerMessage];
    setMessages(nextMessages);
    void requestCommentary({
      reason: "human_chat",
      instruction: "Answer the human's chat directly while staying aware of the live chess position.",
      userText: text,
      sourceMessages: nextMessages,
      force: true,
    });
  };

  const handleNewGame = () => {
    streamRef.current?.abort();
    replyingRef.current = false;
    setReplying(false);
    setConnectionError(null);
    setMessages(
      character.greeting
        ? [{ id: uid(), role: "character", text: character.greeting, at: Date.now() }]
        : [],
    );
    game.newGame();
  };

  // King square to highlight when in check.
  const checkSquare = useMemo(() => {
    if (!game.inCheck) return null;
    const board = new Chess(game.fen).board();
    for (const rank of board) {
      for (const sq of rank) {
        if (sq && sq.type === "k" && sq.color === game.turn) return sq.square as string;
      }
    }
    return null;
  }, [game.fen, game.inCheck, game.turn]);

  const squareStyles = useMemo(() => {
    const s: Record<string, React.CSSProperties> = {};
    if (game.lastMove) {
      s[game.lastMove.from] = { background: "rgba(201,162,75,0.30)" };
      s[game.lastMove.to] = { background: "rgba(201,162,75,0.42)" };
    }
    if (game.selected) {
      s[game.selected] = { background: "rgba(124,138,78,0.55)" };
    }
    for (const t of game.legalTargets) {
      s[t] = {
        ...(s[t] ?? {}),
        background:
          "radial-gradient(circle, rgba(20,16,10,0.42) 22%, transparent 24%)",
      };
    }
    if (checkSquare) {
      s[checkSquare] = {
        background: "radial-gradient(circle, rgba(180,50,50,0.85) 38%, transparent 62%)",
      };
    }
    return s;
  }, [game.lastMove, game.selected, game.legalTargets, checkSquare]);

  const boardOptions = useMemo(
    () => ({
      position: game.fen,
      boardOrientation: playerColor,
      allowDragging: game.isPlayerTurn,
      showAnimations: true,
      animationDurationInMs: 220,
      darkSquareStyle: { backgroundColor: "var(--board-dark)" },
      lightSquareStyle: { backgroundColor: "var(--board-light)" },
      boardStyle: {
        borderRadius: "8px",
        overflow: "hidden",
        boxShadow: "0 20px 50px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.4)",
      },
      squareStyles,
      canDragPiece: ({ piece }: { piece: { pieceType: string } }) =>
        game.isPlayerTurn && piece.pieceType[0] === me,
      onPieceDrop: ({
        sourceSquare,
        targetSquare,
      }: {
        sourceSquare: string;
        targetSquare: string | null;
      }) => (targetSquare ? game.tryPlayerMove(sourceSquare, targetSquare) : false),
      onSquareClick: ({ square }: { square: string }) => game.onSquareClick(square),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.fen, game.isPlayerTurn, squareStyles, playerColor, me]
  );

  const statusText = (() => {
    if (game.status === "checkmate")
      return game.resigned ? "You resigned" : game.turn === me ? "Checkmate — you lost" : "Checkmate — you won!";
    if (game.status === "stalemate") return "Stalemate — it's a draw";
    if (game.status === "draw") return "Draw";
    if (game.engineThinking) return `${character.name.split(" ")[0]} is thinking…`;
    return game.isPlayerTurn ? "Your move" : `${character.name.split(" ")[0]}'s move`;
  })();

  const gameOver = game.status !== "playing";

  return (
    <div className={styles.screen} style={{ ["--accent" as string]: character.accent }}>
      <header className={styles.topbar}>
        <button className={styles.exit} onClick={onExit}>
          ‹ Change opponent
        </button>
        <p className={styles.salon}>♟ The Chess Salon</p>
        <span className={styles.engineBadge} title="Active chess engine">
          {engineKind === "stockfish" ? "Stockfish" : "Built-in engine"}
        </span>
      </header>

      <main className={styles.layout}>
        <section className={styles.boardWrap}>
          <div className={styles.board}>
            <Chessboard options={boardOptions} />
          </div>
          <div className={`${styles.statusBar} ${gameOver ? styles.statusOver : ""}`}>
            <span className={styles.turnDot} data-active={game.isPlayerTurn} />
            {statusText}
          </div>
        </section>

        <aside className={styles.side}>
          <motion.div
            className={styles.charCard}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className={styles.charHead}>
              <div className={styles.portrait}>
                <Avatar
                  accent={character.accent}
                  motif={character.motif}
                  imageUrl={character.imageUrl}
                  name={character.name}
                  size={84}
                />
              </div>
              <div>
                <h2 className={styles.charName}>{character.name}</h2>
                <p className={styles.charTitle}>{character.title}</p>
                <p className={styles.charMeta}>Skill {difficulty.skill} · {difficulty.label}</p>
              </div>
            </div>

            <SpeechBubble text={shownBubble} cue={bubbleCue} thinking={waitingForCharacterReply} />

            <button className={styles.chatBtn} onClick={() => setChatOpen(true)}>
              <span className={styles.chatIcon}>💬</span> Open conversation
              {messages.length > 1 && <span className={styles.badge}>{messages.length}</span>}
            </button>

            {connectionError && (
              <p className={styles.connectionError} role="alert">
                {connectionError}
              </p>
            )}
          </motion.div>

          <div className={styles.controls}>
            <button className={styles.btnPrimary} onClick={handleNewGame}>
              New game
            </button>
            <button
              className={styles.btnGhost}
              onClick={game.resign}
              disabled={gameOver}
            >
              Resign
            </button>
          </div>

          <div className={styles.moves}>
            <span className={styles.movesLabel}>Moves</span>
            <ol className={styles.moveList}>
              {game.history.length === 0 && <li className={styles.empty}>No moves yet.</li>}
              {pairs(game.history).map((p, i) => (
                <li key={i} className={styles.moveRow}>
                  <span className={styles.moveNum}>{i + 1}.</span>
                  <span className={styles.moveSan}>{p[0]}</span>
                  <span className={styles.moveSan}>{p[1] ?? ""}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </main>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        character={character}
        messages={messages}
        onSend={handleSend}
        responding={replying}
      />

      {engineKind === "builtin" && !engineLoading && (
        <p className={styles.engineHint}>
          Playing the built-in engine. Drop a <code>stockfish.js</code> worker into{" "}
          <code>/public</code> for full strength — see <code>public/README.md</code>.
        </p>
      )}
    </div>
  );
}

function pairs(history: string[]): [string, string?][] {
  const out: [string, string?][] = [];
  for (let i = 0; i < history.length; i += 2) out.push([history[i], history[i + 1]]);
  return out;
}
