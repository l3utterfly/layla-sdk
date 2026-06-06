import type { Difficulty } from "./types";

export const DIFFICULTIES: Difficulty[] = [
  { id: "casual", label: "Casual", skill: 2, moveTimeMs: 300, blurb: "Forgiving. Great for learning." },
  { id: "club", label: "Club", skill: 7, moveTimeMs: 600, blurb: "A steady, sensible opponent." },
  { id: "sharp", label: "Sharp", skill: 12, moveTimeMs: 900, blurb: "Punishes loose play." },
  { id: "expert", label: "Expert", skill: 17, moveTimeMs: 1200, blurb: "Genuinely tough." },
  { id: "master", label: "Master", skill: 20, moveTimeMs: 1600, blurb: "Full strength. Good luck." },
];
