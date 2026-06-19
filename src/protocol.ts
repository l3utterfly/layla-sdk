/**
 * protocol.ts
 * -----------
 * The native wire contract: every type that must stay in sync with the React
 * Native host. If the native side changes, this is the file that changes with
 * it. Nothing here has runtime behaviour — it's pure types plus the one global
 * declaration for the bridge channel.
 *
 * Adding a one-shot endpoint touches this file in two spots: a command in
 * `LaylaApiRequest` and a response in `LaylaApiEvent`.
 */

/* ---- the bridge channel ---------------------------------------------------- */

declare global {
  interface Window {
    /** Injected by the React Native <WebView> when its `onMessage` prop is set. */
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/* ---- chat messages --------------------------------------------------------- */

export type LaylaChatRole =
  | 'system'
  | 'user'
  | 'assistant';

/** An OpenAI-style chat message. */
export interface LaylaChatMessage {
  role: LaylaChatRole;
  content: string | null;
  name?: string;
}

export interface LaylaChatHistoryEntry extends LaylaChatMessage {
  id: number;
  character_id: string;
  session_id: string;
  timestamp: number;
}

/* ---- character cards ------------------------------------------------------- */

export interface LaylaCharacter {
  id: string;
  data: TavernCardV2;
}

/* ---- memory ----------------------------------------------------------------- */

export interface LaylaMemory {
  id: number;
  character_id: string;
  rawText: string;
  timestamp: number;
  summary: string | null;
  knowledgeGraphJSON: string | null; // JSON string representing the knowledge graph associated with this memory, which may include entities, relationships, and other relevant metadata extracted from the memory content
}

/* ---- Sentiment Analysis ---------------------------------------------------- */
export const SENTIMENT_EMOJIS = {
  admiration: '🤩',
  amusement: '😂',
  anger: '😡',
  annoyance: '😒',
  approval: '👍',
  caring: '🥰',
  confusion: '😕',
  curiosity: '🤔',
  desire: '😏',
  disappointment: '😞',
  disapproval: '👎',
  disgust: '🤢',
  embarrassment: '😳',
  excitement: '😆',
  fear: '😱',
  gratitude: '🙏',
  grief: '😢',
  joy: '😄',
  love: '❤️',
  nervousness: '😬',
  optimism: '😊',
  pride: '🦚',
  realization: '😮',
  relief: '😅',
  remorse: '😔',
  sadness: '😢',
  surprise: '😲',
  neutral: '😐',
};

export const SENTIMENT_THRESHOLDS = {
  admiration: 0.3,
  amusement: 0.25,
  anger: 0.15,
  annoyance: 0.2,
  approval: 0.15,
  caring: 0.2,
  confusion: 0.15,
  curiosity: 0.2,
  desire: 0.2,
  disappointment: 0.1,
  disapproval: 0.15,
  disgust: 0.2,
  embarrassment: 0.3,
  excitement: 0.25,
  fear: 0.4,
  gratitude: 0.25,
  grief: 0.85,
  joy: 0.2,
  love: 0.3,
  nervousness: 0.6,
  optimism: 0.2,
  pride: 0.7,
  realization: 0.1,
  relief: 0.5,
  remorse: 0.2,
  sadness: 0.2,
  surprise: 0.15,
  neutral: 0.3,
};

export type SentimentValues = typeof SENTIMENT_THRESHOLDS;

/**
 * A character card following the Character Card V2 spec (`chara_card_v2`), as
 * returned by the host's `get_characters` handler. If your app already exports
 * its own `TavernCardV2`, prefer importing that — they describe the same shape.
 */
export interface TavernCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    character_book?: TavernCharacterBook;
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
  };
}

export interface TavernCharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: Array<{
    keys: string[];
    content: string;
    extensions: Record<string, unknown>;
    enabled: boolean;
    insertion_order: number;
    case_sensitive?: boolean;
    name?: string;
    priority?: number;
    id?: number;
    comment?: string;
    selective?: boolean;
    secondary_keys?: string[];
    constant?: boolean;
    position?: 'before_char' | 'after_char';
  }>;
}

/* ---- Web -> RN commands ---------------------------------------------------- */

/** Send a conversation for completion (a streaming request). */
export interface LaylaApiSendMessage {
  cmd: 'send_message';
  data: LaylaChatMessage[];
}

/** Ask the host for the list of available character cards (a one-shot request). */
export interface LaylaApiGetCharacters {
  cmd: 'get_characters';
  data: {
    offset: number;
    limit: number;
  }
}

/** Ask the host for a character image identified by <characterId>. */
export interface LaylaApiGetCharacterImage {
  cmd: 'get_character_image';
  data: {
    character_id: string;
  };
}


/**
 * Stop the in-flight generation.
 *
 * Native contract: on receiving this, the host MUST stop the current
 * generation and then emit a normal `on_message_end` (or `on_error`) for that
 * request. That terminating event is the acknowledgement the SDK waits for
 * before starting the next queued request, so it must always be sent — even
 * when generation was cut short. Tokens already posted before the host
 * processes the cancel are harmless; the SDK swallows them.
 */
export interface LaylaApiCancel {
  cmd: 'cancel';
}

/**
 * Ask the host to generate an image based on the provided prompt. The host should respond with an `on_generate_image_response` event containing the generated image encoded in base64 (including the data URI prefix).
 */
export interface LaylaApiGenerateImage {
  cmd: 'generate_image';
  data: {
    prompt: string;
    img2img_base64?: string; // optional base64-encoded image for img2img generation (including the data URI prefix)
  };
}

/**
 * Ask the host to update a character's data. The host should update the character identified by `character_id` with the provided `character_data`.
 * If the character ID does not exist, the host will create a new character.
 * You can include an "image" field in character_data.data.extensions to update the character's image. The "image" field should contain the new image data encoded in base64 (including the data URI prefix).
 * The host should respond with an `on_update_character_response` event containing the updated character id after the update is applied.
 */
export interface LaylaApiUpdateCharacter {
  cmd: 'update_character';
  data: {
    character_id: string;
    character_data: TavernCardV2;
  };
}

/**
 * Ask the host for the chat history associated with a specific session ID.
 * The host should respond with an `on_get_chat_history_response` event containing an array of chat messages, each including the role, content, character ID, and timestamp.
 * The messages should be returned in reverse chronological order (newest to oldest).
 */
export interface LaylaApiGetChatHistory {
  cmd: 'get_chat_history';
  data: {
    session_id: string;
    offset: number;
    limit: number;
  };
}

/**
 * Ask the host to analyze the sentiment of the provided text.
 * The host should respond with an `on_get_sentiment_response` event containing the sentiment values for each emotion category defined in `SentimentValues`.
 * Each sentiment value should be a number between 0 and 1, representing the intensity of that emotion in the input text.
 */
export interface LaylaApiGetSentiment {
  cmd: 'get_sentiment';
  data: {
    text: string;
  }
}

/**
 * Ask the host for the chat sessions associated with a specific character ID.
 * The host should respond with an `on_get_chat_sessions_response` event containing an array of chat sessions, including the session ID, last message timestamp, and the last message content
 */
export interface LaylaApiGetChatSessions {
  cmd: 'get_chat_sessions';
  data: {
    character_id: string;
    offset: number;
    limit: number;
  }
}

/**
 * Ask the host to save a chat message to the history of a specific session.
 * A new session will be created if the provided `session_id` does not exist.
 * If provided id <= 0, a new chat message will be created. Otherwise, the existing chat message with the provided id will be updated.
 * The host should respond with an `on_save_chat_message_response` event containing the saved chat message.
 */
export interface LaylaApiSaveChatMessage {
  cmd: 'save_chat_message';
  data: LaylaChatHistoryEntry;
}

/**
 * Ask the host to save a file with the given filename and content. The host should handle the file saving process (e.g., by storing it locally)
 * The host should respond with an `on_save_file_response` event indicating whether the file was saved successfully
 */
export interface LaylaApiSaveFile {
  cmd: 'save_file';
  data: {
    filename: string;
    content_base64: string; // file content encoded in base64 (excluding the data URI prefix)
    share: boolean; // whether the host should show a share sheet after saving the file to allow the user to share it with other apps (if not, host will save it to the app's private directory)
  };
}

/**
 * Asks the host to read the contents of a file with the given filename + extension. Only reads files in your app's private directory.
 * The host will respond with an `on_read_file_response` event containing the file content encoded in base64 (including the data URI prefix).
 */
export interface LaylaApiReadFile {
  cmd: 'read_file';
  data: {
    filename: string;
  };
}

/**
 * Ask the host for the memories associated with a specific character ID.
 * The host should respond with an `on_get_memories_response` event containing an array of memories, each including the content, timestamp, and any additional metadata.
 * The memories should be returned in reverse chronological order (newest to oldest). 
*/
export interface LaylaApiGetMemories {
  cmd: 'get_memories';
  data: {
    character_id: string;
    offset: number;
    limit: number;
    min_timestamp?: number; // if provided, only return memories created after this timestamp
    max_timestamp?: number; // if provided, only return memories created before this timestamp
  };
}

/**
 * Ask the host for the top memories associated with a specific character ID. This heuristic is determined by the host.
 * The host should respond with an `on_get_top_memories_response` event containing an array of the top memories, each including the content, timestamp, and any additional metadata.
 * The memories are returned in reverse chronological order (newest to oldest) and should include the content, timestamp, and any additional metadata.
 */
export interface LaylaApiGetTopMemories {
  cmd: 'get_top_memories';
  data: {
    character_id: string;
    limit: number;
  };
}

/**
 * Ask the host to create a new memory or update existing memories
 * If `memory.id` is <= 0, a new memory will be created. Otherwise, the existing memory with the provided id will be updated.
 * The host should respond with an `on_create_or_update_memories_response` event containing the created or updated memories after the operation is applied.
 */
export interface LaylaApiCreateOrUpdateMemories {
  cmd: 'create_or_update_memories';
  data: LaylaMemory[]; // if memory.id <= 0, a new memory will be created. Otherwise, the existing memory with the provided id will be updated.
};

/**
 * A request command (anything that opens a job and expects events back).
 * Add new one-shot commands here. `cancel` is not a request — it's a control
 * signal for an already-open job — so it lives outside this union.
 */
export type LaylaApiRequest =
  | LaylaApiSendMessage
  | LaylaApiGetCharacters
  | LaylaApiGetCharacterImage
  | LaylaApiCancel
  | LaylaApiGenerateImage
  | LaylaApiUpdateCharacter
  | LaylaApiGetChatHistory
  | LaylaApiGetSentiment
  | LaylaApiGetChatSessions
  | LaylaApiSaveChatMessage
  | LaylaApiSaveFile
  | LaylaApiReadFile
  | LaylaApiGetMemories
  | LaylaApiGetTopMemories
  | LaylaApiCreateOrUpdateMemories;

/* ---- RN -> Web events ------------------------------------------------------ */

/** A streamed token. `msg` is the full snapshot, `delta` is new. */
export interface LaylaApiEvent_onMsg {
  event: 'on_message';
  data: { msg: string; delta: string };
}

/** Stream finished. */
export interface LaylaApiEvent_onMsgEnd {
  event: 'on_message_end';
}

/** Error. Terminates whatever request is in flight, of any kind. */
export interface LaylaApiEvent_onError {
  event: 'on_error';
  data: { message: string };
}

/** The character card list for a `get_characters` request. */
export interface LaylaApiEvent_onGetCharactersResponse {
  event: 'on_get_characters_response';
  data: LaylaCharacter[];
}

/** The character image for a `get_character_image` request, encoded in base64 (includes the data URI prefix) */
export interface LaylaApiEvent_onGetCharacterImageResponse {
  event: 'on_get_character_image_response';
  data: {
    character_id: string;
    image_data_base64: string | null;
  } | null; // null if the character doesn't have an image or if there was an error retrieving it
}

/**
 * The generated image for a `generate_image` request, encoded in base64 (includes the data URI prefix). If `image_data_base64` is null, it indicates that there was an error during image generation.
 */
export interface LaylaApiEvent_onGenerateImageResponse {
  event: 'on_generate_image_response';
  data: {
    image_data_base64: string | null;
  } | null; // null if there was an error generating the image
}

/**
 * Progress update for a `generate_image` request. The host can emit multiple progress events during the image generation process, providing updates on the current status and progress of the generation.
 */
export interface LaylaApiEvent_onGenerateImageProgress {
  event: 'on_generate_image_progress';
  data: {
    status: string; // e.g., "Generating image...", "Refining details...", etc.
    steps: number; // current step number
    total_steps: number; // total number of steps for the generation process
  };
}

/**
 * The response for an `update_character` request, containing the updated character id after the update is applied.
 * Note: the ID may not be the same as the one in the request if a new character was created (i.e., if the provided `character_id` did not exist before). In that case, the response will contain the new character ID assigned by the host.
 */
export interface LaylaApiEvent_onUpdateCharacterResponse {
  event: 'on_update_character_response';
  data: {
    character_id: string;
  };
}

/**
 * The chat history for a `get_chat_history` request, containing an array of chat messages associated with the specified session ID.
 * Each message includes the role, content, session ID, and timestamp. The host should return the messages in reverse chronological order (newest to oldest).
 */
export interface LaylaApiEvent_onGetChatHistoryResponse {
  event: 'on_get_chat_history_response';
  data: {
    session_id: string;
    messages: LaylaChatHistoryEntry[];
  };
}

/**
 * The sentiment analysis results for a `get_sentiment` request, containing the sentiment values for each emotion category defined in `SentimentValues`.
 * Each sentiment value is a number between 0 and 1, representing the intensity of that emotion in the input text.
 */
export interface LaylaApiEvent_onGetSentimentResponse {
  event: 'on_get_sentiment_response';
  data: {
    sentiment_values: SentimentValues;
  };
}

/**
 * The chat sessions for a `get_chat_sessions` request, containing an array of chat sessions associated with the specified character ID.
 * Each session includes the session ID, last message timestamp, and the last message content.
 */
export interface LaylaApiEvent_onGetChatSessionsResponse {
  event: 'on_get_chat_sessions_response';
  data: {
    character_id: string;
    sessions: Array<{
      session_id: string;
      last_message_timestamp: number;
      last_message_content: string;
    }>;
  };
}

/**
 * The response for a `save_chat_message` request, containing the updated chat message after the save is applied.
 * Note: if the provided `id` in the request was <= 0, this indicates that a new chat message was created. In that case, the response will contain the new chat message with its assigned ID and other details.
 * If the provided `id` in the request was > 0, this indicates that an existing chat message was updated. In that case, the response will contain the updated chat message with the same ID and updated details.
 */
export interface LaylaApiEvent_onSaveChatMessageResponse {
  event: 'on_save_chat_message_response';
  data: LaylaChatHistoryEntry;
}

/**
 * The response for a `save_file` request, indicating whether the file was saved successfully and providing an optional message with additional information about the save operation (e.g., error details if the save was not successful).
 */
export interface LaylaApiEvent_onSaveFileResponse {
  event: 'on_save_file_response';
  data: {
    filename: string;
    success: boolean;
    message?: string; // optional message providing additional information about the save operation (e.g., error details if success is false)
  };
}

/**
 * The response for a `read_file` request, containing the file content encoded in base64 (including the data URI prefix) if the read operation was successful.
 * If there was an error reading the file (e.g., file not found, access denied, etc.), `content_base64` will be null, and an optional message may be provided with additional information about the read operation (e.g., error details).
 */
export interface LaylaApiEvent_onReadFileResponse {
  event: 'on_read_file_response';
  data: {
    filename: string;
    content_base64: string | null; // file content encoded in base64 (including the data URI prefix). If null, it indicates that there was an error reading the file (e.g., file not found, access denied, etc.)
    message?: string; // optional message providing additional information about the read operation (e.g., error details if content_base64 is null)
  }
}


/**
 * The response for a `get_memories` request, containing an array of memories associated with the specified character ID in reverse chronological order (newest to oldest).
 */
export interface LaylaApiEvent_onGetMemoriesResponse {
  event: 'on_get_memories_response';
  data: {
    character_id: string;
    memories: LaylaMemory[];
  };
}

/**
 * The response for a `create_or_update_memories` request, containing the created or updated memories after the operation is applied.
 */
export interface LaylaApiEvent_onCreateOrUpdateMemoriesResponse {
  event: 'on_create_or_update_memories_response';
  data: {
    character_id: string;
    memories: LaylaMemory[]; // the created or updated memories with their assigned IDs and other details
  };
}

/**
 * The response for a `get_top_memories` request, containing an array of the top memories associated with the specified character ID in reverse chronological order (newest to oldest).
 */
export interface LaylaApiEvent_onGetTopMemoriesResponse {
  event: 'on_get_top_memories_response';
  data: {
    character_id: string;
    memories: LaylaMemory[]; // the top memories returned by the host based on its heuristic, in reverse chronological order (newest to oldest) and including the content, timestamp, and any additional metadata
  };
}

export type LaylaApiEvent =
  | LaylaApiEvent_onMsg
  | LaylaApiEvent_onMsgEnd
  | LaylaApiEvent_onError
  | LaylaApiEvent_onGetCharactersResponse
  | LaylaApiEvent_onGetCharacterImageResponse
  | LaylaApiEvent_onGenerateImageResponse
  | LaylaApiEvent_onGenerateImageProgress
  | LaylaApiEvent_onUpdateCharacterResponse
  | LaylaApiEvent_onGetChatHistoryResponse
  | LaylaApiEvent_onGetSentimentResponse
  | LaylaApiEvent_onGetChatSessionsResponse
  | LaylaApiEvent_onSaveChatMessageResponse
  | LaylaApiEvent_onSaveFileResponse
  | LaylaApiEvent_onReadFileResponse
  | LaylaApiEvent_onGetMemoriesResponse
  | LaylaApiEvent_onGetTopMemoriesResponse
  | LaylaApiEvent_onCreateOrUpdateMemoriesResponse;
