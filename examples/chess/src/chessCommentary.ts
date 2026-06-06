import { Chess } from "chess.js";
import type { Character, ChatMessage, PlayerColor } from "./types";
import type { GameEvent, GameMoveFacts } from "./hooks/useChessGame";
import type { LaylaChatMessage } from "./layla";

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export type CommentaryReason =
  | "human_chat"
  | "player_move"
  | "character_move"
  | "check"
  | "game_over";

export interface CommentaryPayload {
  reason: CommentaryReason;
  instruction: string;
  game: {
    turn: "white" | "black";
    playerSide: PlayerColor;
    characterSide: PlayerColor;
    phase: "opening" | "middlegame" | "endgame";
    status: string;
    moveCount: number;
    moveHistorySAN: string;
  };
  lastMove?: {
    by: "human" | "character";
    san: string;
    from: string;
    to: string;
    piece: string;
    captured?: string;
    promotion?: string;
    flags: string[];
    summary: string;
  };
  position: {
    material: string;
    characterMaterial: number;
    playerMaterial: number;
    inCheck: boolean;
    legalReplyCount: number;
  };
  recentBanter: Array<{ speaker: "human" | "character"; text: string }>;
}

function sideName(color: "w" | "b") {
  return color === "w" ? "white" : "black";
}

function playerSideChar(playerColor: PlayerColor) {
  return playerColor === "white" ? "w" : "b";
}

function pieceName(piece?: string) {
  return piece ? PIECE_NAMES[piece] ?? piece : undefined;
}

function moveFlags(move: GameMoveFacts) {
  const flags: string[] = [];
  if (move.captured) flags.push("capture");
  if (move.isCheck) flags.push("check");
  if (move.isCheckmate) flags.push("checkmate");
  if (move.isKingsideCastle || move.isQueensideCastle) flags.push("castling");
  if (move.isPromotion) flags.push("promotion");
  if (move.isEnPassant) flags.push("en passant");
  return flags;
}

function phaseFor(fen: string, moveCount: number): CommentaryPayload["game"]["phase"] {
  if (moveCount <= 10) return "opening";
  const game = new Chess(fen);
  let queens = 0;
  let material = 0;
  for (const rank of game.board()) {
    for (const sq of rank) {
      if (!sq) continue;
      if (sq.type === "q") queens += 1;
      material += PIECE_VALUES[sq.type] ?? 0;
    }
  }
  if (queens === 0 || material <= 18) return "endgame";
  return "middlegame";
}

function materialFor(fen: string, playerColor: PlayerColor) {
  const game = new Chess(fen);
  const playerChar = playerSideChar(playerColor);
  let player = 0;
  let character = 0;

  for (const rank of game.board()) {
    for (const sq of rank) {
      if (!sq) continue;
      const value = PIECE_VALUES[sq.type] ?? 0;
      if (sq.color === playerChar) player += value;
      else character += value;
    }
  }

  const diff = character - player;
  const material =
    diff === 0
      ? "material is equal"
      : diff > 0
        ? `character is ahead by ${diff} point${diff === 1 ? "" : "s"} of material`
        : `human is ahead by ${Math.abs(diff)} point${diff === -1 ? "" : "s"} of material`;

  return { player, character, material };
}

function summarizeMove(move: GameMoveFacts) {
  const mover = move.by === "player" ? "human" : "character";
  const piece = pieceName(move.piece) ?? "piece";
  const captured = pieceName(move.captured);

  if (move.isCheckmate) return `${mover} played ${move.san}, delivering checkmate.`;
  if (move.isKingsideCastle || move.isQueensideCastle) return `${mover} castled with ${move.san}.`;
  if (move.isPromotion) return `${mover} promoted with ${move.san}.`;
  if (captured) {
    return `${mover} played ${move.san}, moving a ${piece} from ${move.from} to ${move.to} and capturing a ${captured}.`;
  }
  if (move.isCheck) return `${mover} played ${move.san}, giving check.`;
  return `${mover} played ${move.san}, moving a ${piece} from ${move.from} to ${move.to}.`;
}

export function shouldRequestCommentary(event: GameEvent) {
  if (event.kind === "start") return false;
  if (event.kind === "player-win" || event.kind === "player-lose" || event.kind === "draw") return true;
  if (event.kind === "check") return true;
  const move = event.move;
  if (!move) return false;
  if (move.by === "player") return true;
  return Boolean(
    move.captured ||
      move.isPromotion ||
      move.isKingsideCastle ||
      move.isQueensideCastle ||
      event.history.length <= 8
  );
}

export function buildCommentaryPayload(params: {
  reason: CommentaryReason;
  instruction: string;
  event: GameEvent;
  fen: string;
  playerColor: PlayerColor;
  messages: ChatMessage[];
}): CommentaryPayload {
  const { reason, instruction, event, fen, playerColor, messages } = params;
  const game = new Chess(fen);
  const material = materialFor(fen, playerColor);
  const characterSide = playerColor === "white" ? "black" : "white";
  const moveCount = event.history.length;

  return {
    reason,
    instruction,
    game: {
      turn: sideName(game.turn()),
      playerSide: playerColor,
      characterSide,
      phase: phaseFor(fen, moveCount),
      status: event.kind,
      moveCount,
      moveHistorySAN: event.history.length ? event.history.join(" ") : "(no moves yet)",
    },
    lastMove: event.move
      ? {
          by: event.move.by === "player" ? "human" : "character",
          san: event.move.san,
          from: event.move.from,
          to: event.move.to,
          piece: pieceName(event.move.piece) ?? event.move.piece,
          captured: pieceName(event.move.captured),
          promotion: pieceName(event.move.promotion),
          flags: moveFlags(event.move),
          summary: summarizeMove(event.move),
        }
      : undefined,
    position: {
      material: material.material,
      characterMaterial: material.character,
      playerMaterial: material.player,
      inCheck: game.isCheck(),
      legalReplyCount: game.moves().length,
    },
    recentBanter: messages.slice(-6).map((message) => ({
      speaker: message.role === "player" ? "human" : "character",
      text: message.text,
    })),
  };
}

function formatRecentBanter(payload: CommentaryPayload) {
  if (payload.recentBanter.length === 0) return "Recent chat: none.";
  const lines = payload.recentBanter.map(
    (message) => `${message.speaker === "human" ? "Human" : "You"}: ${message.text}`
  );
  return `Recent chat:\n${lines.join("\n")}`;
}

function formatCommentaryContext(payload: CommentaryPayload) {
  const lines = [
    "Chess context:",
    `You are playing ${payload.game.characterSide}. The human is playing ${payload.game.playerSide}.`,
    `Game phase: ${payload.game.phase}. Current turn: ${payload.game.turn}.`,
    `Game status: ${payload.game.status}. Moves played: ${payload.game.moveCount}.`,
    `Move history: ${payload.game.moveHistorySAN}.`,
    payload.lastMove
      ? `Latest move: ${payload.lastMove.summary}`
      : "Latest move: no move has been played yet.",
    payload.lastMove?.flags.length
      ? `Move tags: ${payload.lastMove.flags.join(", ")}.`
      : "Move tags: quiet move.",
    `Material: ${payload.position.material}.`,
    payload.position.inCheck ? "The side to move is in check." : "The side to move is not in check.",
    `Legal replies available: ${payload.position.legalReplyCount}.`,
    formatRecentBanter(payload),
  ];

  return `[\n${lines.join("\n")}\n]`;
}

export function buildCommentaryMessages(params: {
  character: Character;
  payload: CommentaryPayload;
  userText?: string;
}): LaylaChatMessage[] {
  const { character, payload, userText } = params;
  const personaParts = [
    character.systemPrompt,
    `Name: ${character.name}`,
    `Title: ${character.title}`,
    `Description: ${character.description}`,
    character.personality ? `Personality: ${character.personality}` : "",
    character.scenario ? `Scenario: ${character.scenario}` : "",
    character.messageExample ? `Example dialogue: ${character.messageExample}` : "",
    character.postHistoryInstructions,
  ].filter(Boolean);

  return [
    {
      role: "system",
      content: [
        personaParts.join("\n"),
        "",
        "You are the human player's chess opponent and table-talk companion.",
        "The chess engine chooses your moves. You only comment and answer chat.",
        "React only to the bracketed chess context. Never invent captures, checks, mates, threats, piece locations, or legal moves.",
        "Do not suggest a next move unless the context explicitly contains that move.",
        "Keep the reply in character, lively, and short: one or two sentences, under 45 words.",
        "Light trash talk is welcome when it matches the persona, but do not be cruel or abusive.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        formatCommentaryContext(payload),
        userText ? `Human says: ${userText}` : payload.instruction,
      ].join("\n\n"),
    },
  ];
}
