export type PieceMotif = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export type PlayerColor = "white" | "black";

/** A chess opponent persona. Currently dummy data; later this will be
 *  enriched with an LLM persona prompt for live dialogue. */
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
  /** Line shown in the speech bubble when a game begins. */
  greeting: string;
  /** A few canned lines used to fake "talking" until the LLM is wired up. */
  banter: {
    onPlayerMove: string[];
    onOwnMove: string[];
    onCheck: string[];
    onWin: string[];
    onLose: string[];
  };
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
