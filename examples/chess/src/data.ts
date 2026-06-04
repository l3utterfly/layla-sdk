import type { Character, Difficulty } from "./types";

/** Placeholder personas. Profile art is generated locally (see Avatar),
 *  so there are no external image dependencies. Swap `banter` for live
 *  LLM dialogue once the API is connected. */
export const CHARACTERS: Character[] = [
  {
    id: "pip",
    name: "Little Pip",
    title: "The Eager Apprentice",
    description:
      "Just learned how the horse moves and wildly proud of it. Plays with more heart than sense.",
    accent: "#7fae6a",
    motif: "pawn",
    suggestedSkill: 1,
    greeting: "Oh! A real game? I've been practising. Be gentle… or don't!",
    banter: {
      onPlayerMove: ["Ooh, clever.", "I did not see that coming.", "Hmm, let me think…"],
      onOwnMove: ["There! I think that's good?", "Took me a while but here goes.", "Push the little ones forward!"],
      onCheck: ["Eep — is that check?!", "Wait, wait, my king!"],
      onWin: ["I WON? I actually won!", "Did you let me? Don't tell me if you did."],
      onLose: ["Aw. Good game though, really!", "Teach me that trick someday."],
    },
  },
  {
    id: "roland",
    name: "Sir Roland",
    title: "The Errant Knight",
    description:
      "A wandering tactician who adores forks, feints and impossible-looking sacrifices.",
    accent: "#5b8fb0",
    motif: "knight",
    suggestedSkill: 6,
    greeting: "Well met. I warn you — I do love a good ambush from the flank.",
    banter: {
      onPlayerMove: ["A solid reply.", "Cautious. I respect it.", "You leave me an opening…"],
      onOwnMove: ["The horse leaps!", "A fork, if you'd be so kind.", "Onward, ever sideways."],
      onCheck: ["Guard your king, friend.", "Check — and the chase begins."],
      onWin: ["A worthy duel. Victory is mine.", "The knight rides home."],
      onLose: ["Bested fairly. My sword is yours.", "Ha! A lesson well taught."],
    },
  },
  {
    id: "mireille",
    name: "Sister Mireille",
    title: "The Serene Bishop",
    description:
      "Patient and positional. Speaks softly, builds slowly, and squeezes without mercy.",
    accent: "#9b7fc4",
    motif: "bishop",
    suggestedSkill: 10,
    greeting: "Peace before the storm. Let us see where the long diagonals lead us.",
    banter: {
      onPlayerMove: ["Interesting. The position breathes.", "Patience reveals all.", "You feel the tension too."],
      onOwnMove: ["Along the diagonal, quietly.", "A small improvement.", "The bishop sees far."],
      onCheck: ["Mind your shelter.", "The light squares betray you."],
      onWin: ["The slow current carries the day.", "Stillness wins, in the end."],
      onLose: ["You out-waited me. Beautifully done.", "I shall meditate on that one."],
    },
  },
  {
    id: "tomas",
    name: "Old Tomas",
    title: "The Castellan",
    description:
      "Immovable in defence and merciless in endgames. He will grind you to dust, slowly.",
    accent: "#c08a4e",
    motif: "rook",
    suggestedSkill: 13,
    greeting: "No tricks from me, lad. Just walls, and the long game. Settle in.",
    banter: {
      onPlayerMove: ["Won't help you.", "Seen it before.", "Keep trying."],
      onOwnMove: ["Rook to the open file.", "Brick by brick.", "Endgames are where I live."],
      onCheck: ["That all you've got?", "Tuck your king away."],
      onWin: ["Patience always pays.", "Told you. The long game."],
      onLose: ["Hmph. Sharper than you look.", "Fine play. I'll remember it."],
    },
  },
  {
    id: "beatrix",
    name: "Duchess Beatrix",
    title: "The Iron Queen",
    description:
      "Ferociously aggressive and allergic to passivity. Expect her queen in your camp by move ten.",
    accent: "#c6536f",
    motif: "queen",
    suggestedSkill: 16,
    greeting: "Shall we dispense with the pleasantries? I do so enjoy a swift execution.",
    banter: {
      onPlayerMove: ["How quaint.", "Is that meant to frighten me?", "Adorable."],
      onOwnMove: ["The queen advances.", "Bow now, it's easier.", "I do tire of waiting."],
      onCheck: ["Check, darling.", "Run. It won't matter."],
      onWin: ["As expected. Do try harder.", "Another crown for the collection."],
      onLose: ["You… beat me. How thrilling.", "Impudent. And rather magnificent."],
    },
  },
  {
    id: "kasimir",
    name: "Kasimir",
    title: "The Exiled King",
    description:
      "A deposed grandmaster who has forgotten more theory than most will ever learn. Flawless.",
    accent: "#b8b3a8",
    motif: "king",
    suggestedSkill: 20,
    greeting: "I have all the time in the world, and none of it for mistakes. Begin.",
    banter: {
      onPlayerMove: ["Noted.", "Predictable, but sound.", "We have been here before, you and I."],
      onOwnMove: ["Inevitable.", "The only move.", "It was decided long ago."],
      onCheck: ["Check. Calculate carefully.", "Your defence has a flaw."],
      onWin: ["The crown is heavy, but mine.", "You played well. It was not enough."],
      onLose: ["Extraordinary. The throne is yours.", "I concede. Few ever earn that word from me."],
    },
  },
];

export const DIFFICULTIES: Difficulty[] = [
  { id: "casual", label: "Casual", skill: 2, moveTimeMs: 300, blurb: "Forgiving. Great for learning." },
  { id: "club", label: "Club", skill: 7, moveTimeMs: 600, blurb: "A steady, sensible opponent." },
  { id: "sharp", label: "Sharp", skill: 12, moveTimeMs: 900, blurb: "Punishes loose play." },
  { id: "expert", label: "Expert", skill: 17, moveTimeMs: 1200, blurb: "Genuinely tough." },
  { id: "master", label: "Master", skill: 20, moveTimeMs: 1600, blurb: "Full strength. Good luck." },
];
