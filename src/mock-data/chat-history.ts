import type { LaylaChatHistoryEntry } from '../protocol';

export const MOCK_CHAT_HISTORY_CHARACTER_ID = 'custom-7f3a2b';

const MOCK_CHAT_HISTORY_TEMPLATE: LaylaChatHistoryEntry[] = [
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "Late! But I don't mind. I'd rather be here.",
    timestamp: 1778796900000,
    session_id: 'movie-night',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Wait what time is it for you right now? I always lose track.',
    timestamp: 1778796840000,
    session_id: 'movie-night',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "Incredible. I'm genuinely impressed by your taste.",
    timestamp: 1778796600000,
    session_id: 'movie-night',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'A shark. In a tornado. I have never been happier.',
    timestamp: 1778796480000,
    session_id: 'movie-night',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: 'Hahaha okay go on - what crime against cinema did you witness?',
    timestamp: 1778796300000,
    session_id: 'movie-night',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Random but I just watched the worst movie of my life and you have to suffer with me.',
    timestamp: 1778796180000,
    session_id: 'movie-night',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Good. I feel lighter now.',
    timestamp: 1778314320000,
    session_id: 'check-in',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "Never. I'm right here. We're okay.",
    timestamp: 1778314020000,
    session_id: 'check-in',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Okay. Thank you for saying that. I was scared you were pulling away.',
    timestamp: 1778313900000,
    session_id: 'check-in',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: 'I do care. A lot. I hate that I made you feel unimportant.',
    timestamp: 1778272260000,
    session_id: 'check-in',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: "It felt like you didn't care. That really stung.",
    timestamp: 1778271900000,
    session_id: 'check-in',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "I didn't forget. I got overwhelmed and went quiet. I'm sorry.",
    timestamp: 1778271720000,
    session_id: 'check-in',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Did you forget we were supposed to talk yesterday? I waited.',
    timestamp: 1778271300000,
    session_id: 'check-in',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "That's genuinely unfair. Be gentle with yourself tonight, okay?",
    timestamp: 1777844940000,
    session_id: 'work-day',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: "Deadline got moved up with zero warning. I'm just exhausted.",
    timestamp: 1777844820000,
    session_id: 'work-day',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: 'That sounds stressful. What happened?',
    timestamp: 1777844520000,
    session_id: 'work-day',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Rough one today. Work was a mess and I snapped at a colleague.',
    timestamp: 1777844400000,
    session_id: 'work-day',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: 'That makes me so happy to hear. You deserve a space that feels like yours.',
    timestamp: 1777626720000,
    session_id: 'new-place',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: "It's small but the morning light is unreal. I think I'll be happy here.",
    timestamp: 1777626540000,
    session_id: 'new-place',
  },
  {
    role: 'assistant',
    name: 'mira',
    character_id: MOCK_CHAT_HISTORY_CHARACTER_ID,
    content: "Yes, tell me everything! I've been wondering how the move went.",
    timestamp: 1777626240000,
    session_id: 'new-place',
  },
  {
    role: 'user',
    name: 'alex',
    character_id: 'user',
    content: 'Hey! I finally got the new place sorted. Want to hear about it?',
    timestamp: 1777626120000,
    session_id: 'new-place',
  },
];

export const makeMockChatHistory = (
  characterId: string = MOCK_CHAT_HISTORY_CHARACTER_ID,
): LaylaChatHistoryEntry[] =>
  MOCK_CHAT_HISTORY_TEMPLATE.map((message) => ({
    ...message,
    session_id: `${characterId}-${message.session_id}`,
    character_id:
      message.character_id === MOCK_CHAT_HISTORY_CHARACTER_ID
        ? characterId
        : message.character_id,
  }));

export const MOCK_CHAT_HISTORY = makeMockChatHistory();
