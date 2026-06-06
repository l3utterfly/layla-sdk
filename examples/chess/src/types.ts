export type PieceMotif = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export type PlayerColor = "white" | "black";

/** A chess opponent persona loaded from a Layla character card. */
export interface Character {
  id: string;
  name: string;
  /** Short epithet shown under the name, e.g. "The Duchess". */
  title: string;
  /** One- or two-line description for the selection card. */
  description: string;
  /** Optional persona details from a Layla character card. */
  personality?: string;
  scenario?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  messageExample?: string;
  /** Hex accent colour that themes this character's UI. */
  accent: string;
  /** Chess piece this persona is built around — drives the avatar art. */
  motif: PieceMotif;
  /** Optional portrait loaded from Layla character image data. */
  imageUrl?: string | null;
  /** Suggested Stockfish skill (0–20). The player can still override it. */
  suggestedSkill: number;
  /** Optional opening line from the character card. */
  greeting: string;
}

export interface Difficulty {
  id: string;
  label: string;
  /** Stockfish "Skill Level" UCI option (0–20). */
  skill: number;
  /** Thinking time per move, in milliseconds. */
  moveTimeMs: number;
  blurb: string;
}

export interface GameConfig {
  character: Character;
  playerColor: PlayerColor;
  difficulty: Difficulty;
}

export type ChatRole = "player" | "character";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: number;
}
