// Grab every card image at build time as a { path: url } map
const modules = import.meta.glob('./assets/cards/*.jpg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

// Re-key by card id (filename without extension): "fool", "magician", ...
const cardImages: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.jpg$/, ''),
    url,
  ])
);

/* ============================================================
   TYPES
   ============================================================ */

export interface CardBase {
    id: string;
    numeral: string;
    name: string;
    motif: string;
    keywords: string;
    meaning: string;
}

export interface Card extends CardBase {
    image: string; // CSS-ready image source — swap for a real URL later
}

// Full 78-card tarot deck — 22 Major Arcana + 56 Minor Arcana.
// Schema matches your existing Card objects:
//   { id, numeral, name, motif, keywords, meaning, image }
//
// Conventions used for the Minor Arcana (adjust to taste):
//   • numeral  → the rank label shown on the card: "Ace", "II"–"X", "Page", "Knight", "Queen", "King"
//   • motif    → the suit ("wands" | "cups" | "swords" | "pentacles"), so a renderer can reuse suit art
//   • id       → "suit-rank" in kebab-case (e.g. "wands-ace", "cups-10", "swords-queen")

const TAROT_DATA: Card[] = [
    // ─────────────────────────────  MAJOR ARCANA  ─────────────────────────────
    {
        id: "fool", numeral: "0", name: "The Fool", motif: "fool",
        keywords: "New beginnings · Innocence · Adventure",
        meaning: "A leap into the unknown with the sun at your back. The Fool carries nothing but trust and an open heart. Step off the familiar cliff — the path appears once you begin to walk.", image: ""
    },
    {
        id: "magician", numeral: "I", name: "The Magician", motif: "magician",
        keywords: "Will · Manifestation · Power",
        meaning: "As above, so below. The Magician holds every tool needed to shape reality. Your intention is the spark — act with focus and the elements obey.", image: ""
    },
    {
        id: "priestess", numeral: "II", name: "The High Priestess", motif: "priestess",
        keywords: "Mystery · Wisdom · Secrets",
        meaning: "She guards the threshold between worlds. Knowledge here is felt, not spoken. Sit in stillness and the answer you seek will rise to the surface.", image: ""
    },
    {
        id: "empress", numeral: "III", name: "The Empress", motif: "empress",
        keywords: "Abundance · Nurture · Creation",
        meaning: "Life flowers under her hand. The Empress is fertile ground, sensual pleasure and the patient growth of all you tend. Nourish what you love and watch it bloom.", image: ""
    },
    {
        id: "emperor", numeral: "IV", name: "The Emperor", motif: "emperor",
        keywords: "Structure · Authority · Stability",
        meaning: "Order carved from chaos. The Emperor builds the walls that keep your kingdom safe. Lead with steady discipline and the foundation will hold.", image: ""
    },
    {
        id: "hierophant", numeral: "V", name: "The Hierophant", motif: "hierophant",
        keywords: "Tradition · Wisdom · Belief",
        meaning: "The keeper of old keys. The Hierophant speaks through ritual, mentorship and shared belief. Seek the wisdom passed hand to hand before you forge your own.", image: ""
    },
    {
        id: "lovers", numeral: "VI", name: "The Lovers", motif: "lovers",
        keywords: "Union · Choice · Harmony",
        meaning: "Two paths become one. The Lovers speak of deep connection and a meaningful choice made from the heart. Align your values and the bond endures.", image: ""
    },
    {
        id: "chariot", numeral: "VII", name: "The Chariot", motif: "chariot",
        keywords: "Drive · Victory · Willpower",
        meaning: "Two forces pull in opposite directions — yet you hold the reins. The Chariot charges forward through sheer command of self. Master the tension and the road is yours.", image: ""
    },
    {
        id: "strength", numeral: "VIII", name: "Strength", motif: "strength",
        keywords: "Courage · Patience · Inner power",
        meaning: "The lion is tamed not by force but by a gentle hand. Strength is the quiet mastery of one's own fire. Meet what frightens you with tenderness and it yields.", image: ""
    },
    {
        id: "hermit", numeral: "IX", name: "The Hermit", motif: "hermit",
        keywords: "Solitude · Insight · Guidance",
        meaning: "A single lantern in the dark. The Hermit withdraws to find truth within, then returns to light the way for others. Honour the quiet.", image: ""
    },
    {
        id: "wheel", numeral: "X", name: "Wheel of Fortune", motif: "wheel",
        keywords: "Fate · Cycles · Change",
        meaning: "The wheel is always turning. What was low shall rise. Fortune favours those who move with the current rather than against it.", image: ""
    },
    {
        id: "justice", numeral: "XI", name: "Justice", motif: "justice",
        keywords: "Truth · Fairness · Balance",
        meaning: "The scales weigh without mercy or malice. Justice reveals cause and consequence laid bare. Act with integrity, for every choice returns in kind.", image: ""
    },
    {
        id: "hanged-man", numeral: "XII", name: "The Hanged Man", motif: "hanged-man",
        keywords: "Surrender · Perspective · Pause",
        meaning: "Suspended between worlds, he sees what the upright cannot. The Hanged Man asks you to let go and let the answer come from a new angle. Stillness is its own kind of progress.", image: ""
    },
    {
        id: "death", numeral: "XIII", name: "Death", motif: "death",
        keywords: "Transformation · Endings · Rebirth",
        meaning: "Not an ending, but a turning. Death sweeps away what no longer serves so new life can take root. Surrender to the change and be remade.", image: ""
    },
    {
        id: "temperance", numeral: "XIV", name: "Temperance", motif: "temperance",
        keywords: "Balance · Patience · Alchemy",
        meaning: "Two cups pour into one another in endless, patient measure. Temperance blends opposites into something finer than either alone. Find the middle way and be healed.", image: ""
    },
    {
        id: "devil", numeral: "XV", name: "The Devil", motif: "devil",
        keywords: "Bondage · Temptation · Shadow",
        meaning: "The chains are looser than they look. The Devil shows the desires and fears that bind you — yet you placed the collar there yourself. Name the hunger and you begin to slip free.", image: ""
    },
    {
        id: "tower", numeral: "XVI", name: "The Tower", motif: "tower",
        keywords: "Upheaval · Awakening · Release",
        meaning: "What is built on illusion must fall so something truer can stand. The Tower's lightning is sudden, but it clears the ground for rebirth.", image: ""
    },
    {
        id: "star", numeral: "XVII", name: "The Star", motif: "star",
        keywords: "Hope · Renewal · Faith",
        meaning: "After the storm comes the calm. The Star promises healing, quiet inspiration and a clear sky to wish upon. Trust that the universe is gently realigning in your favour.", image: ""
    },
    {
        id: "moon", numeral: "XVIII", name: "The Moon", motif: "moon",
        keywords: "Intuition · Illusion · Dreams",
        meaning: "Not everything is as it appears. The Moon lights a winding path through the unknown — let instinct, not fear, be your guide through the half-light.", image: ""
    },
    {
        id: "sun", numeral: "XIX", name: "The Sun", motif: "sun",
        keywords: "Joy · Success · Vitality",
        meaning: "Warmth breaks through. The Sun shines on clarity, celebration and well-earned triumph. A radiant season of confidence is unfolding before you.", image: ""
    },
    {
        id: "judgement", numeral: "XX", name: "Judgement", motif: "judgement",
        keywords: "Awakening · Reckoning · Renewal",
        meaning: "The trumpet sounds and the past rises to be weighed. Judgement calls you to answer an inner summons and step into who you are becoming. Forgive, release, and rise.", image: ""
    },
    {
        id: "world", numeral: "XXI", name: "The World", motif: "world",
        keywords: "Completion · Wholeness · Fulfilment",
        meaning: "The circle closes and the dance comes full round. The World marks a journey complete and a threshold to the next. Celebrate how far you have travelled.", image: ""
    },

    // ─────────────────────────────  WANDS (Fire)  ─────────────────────────────
    {
        id: "wands-ace", numeral: "Ace", name: "Ace of Wands", motif: "wands",
        keywords: "Inspiration · Spark · Potential",
        meaning: "A torch offered from the clouds. The Ace of Wands is pure creative fire, the first thrilling impulse to begin. Take it up before the flame cools.", image: ""
    },
    {
        id: "wands-2", numeral: "II", name: "Two of Wands", motif: "wands",
        keywords: "Planning · Choice · Horizon",
        meaning: "The world held in one hand, a staff in the other. The Two of Wands surveys the distance and dares to plan beyond the garden wall. Decide where you wish to sail.", image: ""
    },
    {
        id: "wands-3", numeral: "III", name: "Three of Wands", motif: "wands",
        keywords: "Expansion · Foresight · Progress",
        meaning: "Ships set out upon a golden sea. The Three of Wands watches early efforts carry far. Your vision is in motion — trust the voyage you began.", image: ""
    },
    {
        id: "wands-4", numeral: "IV", name: "Four of Wands", motif: "wands",
        keywords: "Celebration · Harmony · Home",
        meaning: "Garlands strung between four pillars. The Four of Wands marks joyful arrival, belonging and a milestone worth marking. Rest a while among those who love you.", image: ""
    },
    {
        id: "wands-5", numeral: "V", name: "Five of Wands", motif: "wands",
        keywords: "Conflict · Competition · Tension",
        meaning: "Five staves clash in restless play. The Five of Wands is friction, rivalry and scattered effort. Find the shared aim beneath the noise and the struggle softens.", image: ""
    },
    {
        id: "wands-6", numeral: "VI", name: "Six of Wands", motif: "wands",
        keywords: "Victory · Recognition · Pride",
        meaning: "A laurel crown and a cheering crowd. The Six of Wands rides home triumphant, seen at last for the work well done. Accept the praise — you earned the parade.", image: ""
    },
    {
        id: "wands-7", numeral: "VII", name: "Seven of Wands", motif: "wands",
        keywords: "Defense · Courage · Perseverance",
        meaning: "One stands above, six press from below. The Seven of Wands defends hard-won ground against the rising tide. Hold your position; conviction is your higher ground.", image: ""
    },
    {
        id: "wands-8", numeral: "VIII", name: "Eight of Wands", motif: "wands",
        keywords: "Speed · Movement · Momentum",
        meaning: "Eight staves fly swift and straight. The Eight of Wands is sudden motion, news arriving and events accelerating. Act quickly — the air itself is moving.", image: ""
    },
    {
        id: "wands-9", numeral: "IX", name: "Nine of Wands", motif: "wands",
        keywords: "Resilience · Boundaries · Grit",
        meaning: "Wounded but still standing, the last guard at the gate. The Nine of Wands has come too far to fall now. One more push — you are stronger than the weariness.", image: ""
    },
    {
        id: "wands-10", numeral: "X", name: "Ten of Wands", motif: "wands",
        keywords: "Burden · Responsibility · Duty",
        meaning: "An armful of staves bent beneath their weight. The Ten of Wands carries everything alone toward the finish. Set some down — not every load is yours to bear.", image: ""
    },
    {
        id: "wands-page", numeral: "Page", name: "Page of Wands", motif: "wands",
        keywords: "Curiosity · Enthusiasm · Discovery",
        meaning: "A young spark eager to explore. The Page of Wands brings restless ideas and the courage to chase them. Follow the excitement and see where it leads.", image: ""
    },
    {
        id: "wands-knight", numeral: "Knight", name: "Knight of Wands", motif: "wands",
        keywords: "Passion · Action · Adventure",
        meaning: "A rider charging headlong into the heat. The Knight of Wands is bold, magnetic and impatient for the next horizon. Channel the fire before it scatters.", image: ""
    },
    {
        id: "wands-queen", numeral: "Queen", name: "Queen of Wands", motif: "wands",
        keywords: "Confidence · Warmth · Charisma",
        meaning: "She holds a sunflower and fears nothing. The Queen of Wands radiates self-assured warmth that draws others near. Own your light without dimming it for anyone.", image: ""
    },
    {
        id: "wands-king", numeral: "King", name: "King of Wands", motif: "wands",
        keywords: "Vision · Leadership · Boldness",
        meaning: "A born leader with fire in his command. The King of Wands turns vision into bold, decisive action. Lead from inspiration and others will follow your flame.", image: ""
    },

    // ─────────────────────────────  CUPS (Water)  ─────────────────────────────
    {
        id: "cups-ace", numeral: "Ace", name: "Ace of Cups", motif: "cups",
        keywords: "Love · Emotion · New feeling",
        meaning: "An overflowing chalice held aloft. The Ace of Cups is the first rush of love, compassion and emotional renewal. Open your heart and let it fill.", image: ""
    },
    {
        id: "cups-2", numeral: "II", name: "Two of Cups", motif: "cups",
        keywords: "Partnership · Attraction · Connection",
        meaning: "Two cups raised in mutual pledge. The Two of Cups is the meeting of equals, a bond formed in tenderness. What is shared with care grows deep.", image: ""
    },
    {
        id: "cups-3", numeral: "III", name: "Three of Cups", motif: "cups",
        keywords: "Friendship · Celebration · Community",
        meaning: "Three cups lifted in a circle of joy. The Three of Cups is friendship, festivity and shared good fortune. Gather your people and toast the good times.", image: ""
    },
    {
        id: "cups-4", numeral: "IV", name: "Four of Cups", motif: "cups",
        keywords: "Apathy · Reflection · Reevaluation",
        meaning: "Three cups ignored, a fourth offered unseen. The Four of Cups is the discontent that overlooks the gift in plain sight. Lift your eyes — something is being held out to you.", image: ""
    },
    {
        id: "cups-5", numeral: "V", name: "Five of Cups", motif: "cups",
        keywords: "Loss · Grief · Acceptance",
        meaning: "Three cups spilled, two still standing behind. The Five of Cups grieves what was lost and forgets what remains. Turn around; not everything has poured away.", image: ""
    },
    {
        id: "cups-6", numeral: "VI", name: "Six of Cups", motif: "cups",
        keywords: "Nostalgia · Innocence · Memory",
        meaning: "A gift of flowers from a gentler time. The Six of Cups is sweet memory, childhood warmth and simple kindness. Let the past comfort you without calling you back.", image: ""
    },
    {
        id: "cups-7", numeral: "VII", name: "Seven of Cups", motif: "cups",
        keywords: "Choices · Illusion · Fantasy",
        meaning: "Seven cups float, each a glittering dream. The Seven of Cups offers dazzling options, not all of them real. Choose with clear eyes before the mist decides for you.", image: ""
    },
    {
        id: "cups-8", numeral: "VIII", name: "Eight of Cups", motif: "cups",
        keywords: "Departure · Searching · Letting go",
        meaning: "A lone figure walks away beneath the moon. The Eight of Cups leaves the familiar in search of deeper meaning. Some things must be left behind to be outgrown.", image: ""
    },
    {
        id: "cups-9", numeral: "IX", name: "Nine of Cups", motif: "cups",
        keywords: "Contentment · Satisfaction · Wishes",
        meaning: "A row of cups and a satisfied smile. The Nine of Cups is the wish fulfilled, comfort earned and pleasure savoured. Let yourself feel how good enough it is.", image: ""
    },
    {
        id: "cups-10", numeral: "X", name: "Ten of Cups", motif: "cups",
        keywords: "Joy · Family · Fulfilment",
        meaning: "A rainbow arched over a happy home. The Ten of Cups is emotional abundance and harmony shared with those you love. This is the peace the heart was seeking.", image: ""
    },
    {
        id: "cups-page", numeral: "Page", name: "Page of Cups", motif: "cups",
        keywords: "Imagination · Sensitivity · Wonder",
        meaning: "A fish surfaces from the cup in surprise. The Page of Cups brings dreamy intuition, creativity and gentle messages. Stay open to the strange and tender.", image: ""
    },
    {
        id: "cups-knight", numeral: "Knight", name: "Knight of Cups", motif: "cups",
        keywords: "Romance · Charm · Idealism",
        meaning: "A rider bears his cup like an offering. The Knight of Cups follows the heart, courting beauty and dreams. Lead with feeling, but keep one hand on the reins.", image: ""
    },
    {
        id: "cups-queen", numeral: "Queen", name: "Queen of Cups", motif: "cups",
        keywords: "Compassion · Intuition · Calm",
        meaning: "She gazes into her cup and understands. The Queen of Cups holds deep feeling with grace and quiet wisdom. Trust your tender knowing; it sees more than logic.", image: ""
    },
    {
        id: "cups-king", numeral: "King", name: "King of Cups", motif: "cups",
        keywords: "Composure · Empathy · Balance",
        meaning: "Calm upon a stormy sea. The King of Cups masters his emotions without silencing them. Feel deeply, yet steer with a steady, generous heart.", image: ""
    },

    // ────────────────────────────  SWORDS (Air)  ─────────────────────────────
    {
        id: "swords-ace", numeral: "Ace", name: "Ace of Swords", motif: "swords",
        keywords: "Clarity · Truth · Breakthrough",
        meaning: "A blade crowned and lifted skyward. The Ace of Swords cuts through fog to reveal the clean truth. A sharp new idea or insight is yours to wield.", image: ""
    },
    {
        id: "swords-2", numeral: "II", name: "Two of Swords", motif: "swords",
        keywords: "Stalemate · Indecision · Avoidance",
        meaning: "Blindfolded, two swords crossed against the heart. The Two of Swords stalls between choices it refuses to see. Lift the blindfold; the decision waits in the light.", image: ""
    },
    {
        id: "swords-3", numeral: "III", name: "Three of Swords", motif: "swords",
        keywords: "Heartbreak · Sorrow · Truth",
        meaning: "Three blades through a single heart. The Three of Swords is the sharp pain of grief and painful honesty. Let the rain fall — clarity follows the storm.", image: ""
    },
    {
        id: "swords-4", numeral: "IV", name: "Four of Swords", motif: "swords",
        keywords: "Rest · Recovery · Stillness",
        meaning: "A knight lies in quiet repose. The Four of Swords is the pause that heals, the necessary retreat from battle. Lay down the sword and let the body mend.", image: ""
    },
    {
        id: "swords-5", numeral: "V", name: "Five of Swords", motif: "swords",
        keywords: "Conflict · Defeat · Discord",
        meaning: "A hollow victory, swords gathered in the dust. The Five of Swords wins the fight but loses the peace. Ask whether being right is worth the cost.", image: ""
    },
    {
        id: "swords-6", numeral: "VI", name: "Six of Swords", motif: "swords",
        keywords: "Transition · Passage · Moving on",
        meaning: "A quiet ferry toward calmer waters. The Six of Swords carries you away from trouble toward gentler shores. The crossing is sad, but it leads somewhere kinder.", image: ""
    },
    {
        id: "swords-7", numeral: "VII", name: "Seven of Swords", motif: "swords",
        keywords: "Strategy · Deception · Stealth",
        meaning: "A figure slips away with stolen blades. The Seven of Swords moves by cunning rather than force. Watch for what is hidden — in others, or in yourself.", image: ""
    },
    {
        id: "swords-8", numeral: "VIII", name: "Eight of Swords", motif: "swords",
        keywords: "Restriction · Fear · Powerlessness",
        meaning: "Bound and blindfolded, ringed by blades. The Eight of Swords feels trapped, though the bindings are loose. The cage is mostly in the mind — take one step.", image: ""
    },
    {
        id: "swords-9", numeral: "IX", name: "Nine of Swords", motif: "swords",
        keywords: "Anxiety · Worry · Dread",
        meaning: "Awake in the dark, head in hands. The Nine of Swords is the fear that grows monstrous at night. Morning shrinks it; the dread is louder than the truth.", image: ""
    },
    {
        id: "swords-10", numeral: "X", name: "Ten of Swords", motif: "swords",
        keywords: "Ending · Collapse · Rock bottom",
        meaning: "Ten blades and a sky beginning to lighten. The Ten of Swords is the painful end that can fall no further. The worst is over — dawn is already breaking.", image: ""
    },
    {
        id: "swords-page", numeral: "Page", name: "Page of Swords", motif: "swords",
        keywords: "Curiosity · Vigilance · Ideas",
        meaning: "A youth holds the sword aloft, alert and quick. The Page of Swords is sharp curiosity and eager truth-seeking. Ask the bold question, but mind your edge.", image: ""
    },
    {
        id: "swords-knight", numeral: "Knight", name: "Knight of Swords", motif: "swords",
        keywords: "Ambition · Drive · Haste",
        meaning: "A rider charges into the wind, blade first. The Knight of Swords moves on pure intellect and urgency. Brilliant and fast — just take care where you aim.", image: ""
    },
    {
        id: "swords-queen", numeral: "Queen", name: "Queen of Swords", motif: "swords",
        keywords: "Clarity · Honesty · Independence",
        meaning: "She sees clearly and speaks plainly. The Queen of Swords cuts through illusion with sharp, fair judgement. Her honesty is a kindness, even when it stings.", image: ""
    },
    {
        id: "swords-king", numeral: "King", name: "King of Swords", motif: "swords",
        keywords: "Authority · Truth · Logic",
        meaning: "A measured mind upon the throne. The King of Swords rules by reason, principle and clear law. Decide with the head, and let fairness guide the blade.", image: ""
    },

    // ──────────────────────────  PENTACLES (Earth)  ──────────────────────────
    {
        id: "pentacles-ace", numeral: "Ace", name: "Ace of Pentacles", motif: "pentacles",
        keywords: "Opportunity · Prosperity · Beginning",
        meaning: "A golden coin offered from the clouds. The Ace of Pentacles is a tangible new chance — wealth, work or wellbeing taking root. Plant it well and it grows.", image: ""
    },
    {
        id: "pentacles-2", numeral: "II", name: "Two of Pentacles", motif: "pentacles",
        keywords: "Balance · Juggling · Adaptability",
        meaning: "Two coins dance in a looping ribbon. The Two of Pentacles juggles competing demands with nimble grace. Stay light on your feet and you keep them all aloft.", image: ""
    },
    {
        id: "pentacles-3", numeral: "III", name: "Three of Pentacles", motif: "pentacles",
        keywords: "Teamwork · Skill · Collaboration",
        meaning: "Three hands shape the cathedral wall. The Three of Pentacles is craft, cooperation and work well combined. Build alongside others and the structure rises true.", image: ""
    },
    {
        id: "pentacles-4", numeral: "IV", name: "Four of Pentacles", motif: "pentacles",
        keywords: "Security · Control · Holding on",
        meaning: "Four coins clutched close and guarded. The Four of Pentacles holds tight for safety, perhaps too tight. Loosen your grip enough to let life move.", image: ""
    },
    {
        id: "pentacles-5", numeral: "V", name: "Five of Pentacles", motif: "pentacles",
        keywords: "Hardship · Loss · Isolation",
        meaning: "Two figures pass a lit window in the snow. The Five of Pentacles is lack, worry and feeling left out in the cold. Help is nearer than the storm lets you see.", image: ""
    },
    {
        id: "pentacles-6", numeral: "VI", name: "Six of Pentacles", motif: "pentacles",
        keywords: "Generosity · Giving · Receiving",
        meaning: "Coins shared, the scales held even. The Six of Pentacles is the flow of generosity between those who have and have not. Give freely, and learn also to receive.", image: ""
    },
    {
        id: "pentacles-7", numeral: "VII", name: "Seven of Pentacles", motif: "pentacles",
        keywords: "Patience · Investment · Growth",
        meaning: "A gardener leans on the hoe, surveying the vines. The Seven of Pentacles waits while effort slowly ripens. Tend, trust, and let the harvest come in its season.", image: ""
    },
    {
        id: "pentacles-8", numeral: "VIII", name: "Eight of Pentacles", motif: "pentacles",
        keywords: "Diligence · Mastery · Craft",
        meaning: "Coin after coin carved with care. The Eight of Pentacles is devoted practice and the patient honing of skill. Love the work and mastery follows.", image: ""
    },
    {
        id: "pentacles-9", numeral: "IX", name: "Nine of Pentacles", motif: "pentacles",
        keywords: "Abundance · Independence · Luxury",
        meaning: "A figure at ease in a flourishing garden. The Nine of Pentacles is self-made comfort, refinement and earned solitude. Savour the fruits of your own discipline.", image: ""
    },
    {
        id: "pentacles-10", numeral: "X", name: "Ten of Pentacles", motif: "pentacles",
        keywords: "Legacy · Wealth · Family",
        meaning: "Generations gathered beneath a sturdy arch. The Ten of Pentacles is lasting prosperity, roots and inheritance. What you build now will shelter those who follow.", image: ""
    },
    {
        id: "pentacles-page", numeral: "Page", name: "Page of Pentacles", motif: "pentacles",
        keywords: "Ambition · Study · Opportunity",
        meaning: "A youth studies a coin like a promise. The Page of Pentacles is the eager student, grounded and ready to learn. Begin the practical work that builds a future.", image: ""
    },
    {
        id: "pentacles-knight", numeral: "Knight", name: "Knight of Pentacles", motif: "pentacles",
        keywords: "Diligence · Routine · Reliability",
        meaning: "A steady rider who never breaks stride. The Knight of Pentacles is patient, dependable and methodical. Unglamorous, perhaps — but he always arrives.", image: ""
    },
    {
        id: "pentacles-queen", numeral: "Queen", name: "Queen of Pentacles", motif: "pentacles",
        keywords: "Nurture · Practicality · Comfort",
        meaning: "She tends home and garden with abundant care. The Queen of Pentacles nurtures body, hearth and those around her. Provide generously, and remember to be provided for too.", image: ""
    },
    {
        id: "pentacles-king", numeral: "King", name: "King of Pentacles", motif: "pentacles",
        keywords: "Wealth · Stability · Provision",
        meaning: "A prosperous ruler amid his thriving estate. The King of Pentacles has built lasting security through patience and shrewdness. Steward your kingdom with a generous, grounded hand.", image: ""
    },
];

export const TAROT: Card[] = TAROT_DATA.map((card) => ({
  ...card,
  image: cardImages[card.id] ?? "",
}));

// const STYLE = `Mystical tarot card illustration rendered as intricate antique-gold line art on a deep indigo-and-violet background. Fine engraved linework with a hand-etched, art-nouveau celestial-alchemical feel; luminous gold filigree, soft glowing violet-blue accents, a faint scattering of stars, and a gentle inner light. A single elegant central motif, vertically composed, ornate but uncluttered, edges fading into a soft dark vignette. Keep the very top and very bottom dim and simple. No text, no letters, no numerals, no card frame or border, no watermark. Atmospheric, dreamlike, elegant, highly detailed.`;

// const SUIT_ACCENT: Record<string, string> = {
//   wands:     "Let the gold lean warm and ember-like, with faint amber firelight glinting in the highlights.",
//   cups:      "Let the highlights lean cool and aqueous, with a soft teal-violet luminescence.",
//   swords:    "Let the highlights lean toward pale, cold steel-blue and thin silver light.",
//   pentacles: "Let the gold lean earthy and verdant, with a faint mossy green-gold patina.",
// };

// const MAJOR_ACCENT =
//   "Render this Major Arcana card in the richest, most luminous antique gold — more ornate and radiant than the rest of the deck.";

// function buildPrompt(card: Card): string {
//   const themes = card.keywords.replace(/ · /g, ", ");
//   const accent = SUIT_ACCENT[card.motif] ?? MAJOR_ACCENT; // non-suit motif → Major Arcana
//   return `${STYLE} Subject — ${card.name}: ${card.meaning} Visual themes: ${themes}. ${accent}`;
// }
// console.log(JSON.stringify(TAROT.map(card => {
//     return {
//         id: card.id,
//         image: buildPrompt(card)
//     }
// })));