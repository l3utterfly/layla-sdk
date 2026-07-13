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

export interface LaylaScheduledChatMessage {
  id: number;
  character_id: string;
  session_id: string | null;
  timestamp: number;
  message: string;
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
  session_id: string;
  rawText: string;
  timestamp: number;
  summary: string | null;
  knowledgeGraphJSON: string | null; // JSON string representing the knowledge graph associated with this memory, which may include entities, relationships, and other relevant metadata extracted from the memory content
}

/* ---- persona --------------------------------------------------------------- */

export interface LaylaPersona {
  name: string;
  description: string;
}

/* --- TTS voices ------------------------------------------------------------- */
export interface LaylaTTSVoice {
  id: string;
  type: string;
  tags: string[];
  name: string;
};

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

export interface LaylaExecutionContext {
  character: LaylaCharacter | null; // the current character context, or null if no character is selected
  session_id: string | null; // the current session ID, or null if no session is active
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
 * Ask the host to schedule a chat message to be sent at a specific timestamp (in the future).
 * The host should store the scheduled message and send it at the specified time for the given character and optional session.
 * The host should respond with an `on_scheduled_chat_message` event containing the scheduled chat message details, including the id, character_id, session_id, timestamp, and message content.
 */
export interface LaylaApiScheduledChatMessage {
  cmd: 'scheduled_chat_message';
  data: LaylaScheduledChatMessage;
}

/**
 * Ask the host for the list of scheduled chat messages.
 * The host should respond with an `on_scheduled_chat_message` event containing an array of scheduled messages, each containing the scheduled chat message details, including the id, character_id, session_id, timestamp, and message content.
 * Note: this API will return ALL scheduled messages. Layla is not designed to handle a large number of scheduled messages, so this API does not support pagination or filtering. The host should return all scheduled messages in a single response and the client should handle any necessary filtering or pagination on its own.
 */
export interface LaylaApiGetScheduledChatMessages {
  cmd: 'get_scheduled_chat_messages';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host to cancel a previously scheduled chat message by its ID.
 * The host should remove the scheduled message from its storage and prevent it from being sent at the specified time.
 * The host should respond with an `on_cancel_scheduled_chat_message` event indicating whether the cancellation was successful or if the scheduled message was not found.
 */
export interface LaylaApiCancelScheduledChatMessage {
  cmd: 'cancel_scheduled_chat_message';
  data: {
    id: number; // the id of the scheduled chat message to cancel
  };
}

/**
 * Ask the host for the default persona or a specific character's persona.
 * The host should respond with an `on_get_persona_response` event containing the requested persona data.
 * If `character_id` is null, the host should return the default persona.
 */
export interface LaylaApiGetPersona {
  cmd: 'get_persona';
  data: {
    character_id: string | null; // if null, return the default persona
  }
}

/**
 * Ask the host for the list of available TTS voices installed in Layla.
 * The host should respond with an `on_get_tts_voices` event containing an array of TTS voices.
 */
export interface LaylaApiGetTTSVoices {
  cmd: 'get_tts_voices';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host to generate voice audio for the provided text using the specified TTS voice.
 * The host will generate the audio and automatically play it on device. The host will respond with an `on_finished_speaking` event when the playback has finished.
 * Developer note:
 *   - the host handles queuing of multiple `generate_voice` requests WITH THE SAME `ttsVoiceId`, so the client does not need to manage queuing or waiting for playback to finish before sending the next request. The host will ensure that each request is processed in order and that the `on_finished_speaking` event is emitted after each playback completes.
 *   - if a different `ttsVoiceId` is used in a subsequent request, this incurs a small performance penalty as the host needs to swap TTS models. Additionally, currently queued voices will be cancelled and playback stopped.
 */
export interface LaylaApiGenerateVoice {
  cmd: 'generate_voice';
  data: {
    ttsVoiceId: string | null; // if null, use the default global TTS voice
    text: string;
  }
}

/**
 * Ask the host to stop any in-progress voice audio playback.
 * The host will immediately stop the playback and respond with an `on_finished_speaking` event to indicate that the playback has been stopped.
 */
export interface LaylaApiStopSpeaking {
  cmd: 'stop_speaking';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host for the list of available inference engines.
 * The host should respond with an `on_get_inference_engines_response` event containing an array of inference engine names.
 * These names can be used to set the inference engine before calling `send_message` to generate a response.
 */
export interface LaylaApiGetInferenceEngines {
  cmd: 'get_inference_engines';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host to set the inference engine to use for subsequent `send_message` requests.
 * The host should respond with an `on_set_inference_engine_response` event indicating whether the inference engine was set successfully or if the specified engine name was not found.
 * If the engine is not found, the host should reset to the default inference engine.
 * If `engineName` is null, the host should reset to the default inference engine.
 */
export interface LaylaApiSetInferenceEngine {
  cmd: 'set_inference_engine';
  data: {
    engineName: string | null; // the name of the inference engine to set, if null, the host should reset to the default inference engine
  };
}

/**
 * Ask the host for the current execution context.
 * The execution context can include information about the current state of the host, such as current character, session, or other relevant data.
 * The execution context can also be null, which means the mini-app is running standalone as a top-level mini-app, without any character or session context.
 * The host should respond with an `on_get_execution_context_response` event containing the current execution context.
 */
export interface LaylaApiGetExecutionContext {
  cmd: 'get_execution_context';
  data: null; // no additional data is needed for this request
}

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
  | LaylaApiCreateOrUpdateMemories
  | LaylaApiScheduledChatMessage
  | LaylaApiCancelScheduledChatMessage
  | LaylaApiGetScheduledChatMessages
  | LaylaApiGetPersona
  | LaylaApiGetTTSVoices
  | LaylaApiGenerateVoice
  | LaylaApiStopSpeaking
  | LaylaApiGetInferenceEngines
  | LaylaApiSetInferenceEngine
  | LaylaApiGetExecutionContext;

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

/**
 * The response for a `scheduled_chat_message` request, containing the scheduled chat message details, including the id, character_id, session_id, timestamp, and message content.
 * This event is emitted by the host after successfully scheduling a chat message to be sent at a specific timestamp (in the future).
 */
export interface LaylaApiEvent_onScheduledChatMessage {
  event: 'on_scheduled_chat_message';
  data: LaylaScheduledChatMessage;
}

/**
 * The response for a `cancel_scheduled_chat_message` request, indicating whether the cancellation was successful or if the scheduled message was not found.
 * This event is emitted by the host after attempting to cancel a previously scheduled chat message by its ID.
 */
export interface LaylaApiEvent_onCancelScheduledChatMessage {
  event: 'on_cancel_scheduled_chat_message';
  data: {
    id: number; // the id of the scheduled chat message that was requested to be canceled
    success: boolean; // whether the cancellation was successful (true) or if the scheduled message was not found (false)
    message?: string; // optional message providing additional information about the cancellation operation (e.g., error details if success is false)
  };
}

/**
 * The response for a `get_scheduled_chat_messages` request, containing an array of all scheduled chat messages, each including the id, character_id, session_id, timestamp, and message content.
 * This event is emitted by the host after successfully retrieving the list of scheduled chat messages.
 */
export interface LaylaApiEvent_onGetScheduledChatMessagesResponse {
  event: 'on_get_scheduled_chat_messages_response';
  data: {
    scheduled_messages: LaylaScheduledChatMessage[]; // an array of all scheduled chat messages, each containing the id, character_id, session_id, timestamp, and message content
  };
}

/**
 * The response for a `get_persona` request, containing the requested persona data for a specific character or the default persona if `character_id` is null.
 * This event is emitted by the host after successfully retrieving the persona data.
 */
export interface LaylaApiEvent_onGetPersonaResponse {
  event: 'on_get_persona_response';
  data: {
    character_id: string | null; // the character ID for which the persona was requested. If null, this is the default persona.
    persona: LaylaPersona;
  }
};

/**
 * The response for a `get_tts_voices` request, containing an array of all available TTS voices installed in Layla.
 * This event is emitted by the host after successfully retrieving the list of TTS voices.
 */
export interface LaylaApiEvent_onGetTTSVoicesResponse {
  event: 'on_get_tts_voices_response';
  data: {
    voices: LaylaTTSVoice[]; // an array of all available TTS voices installed in Layla
  };
}

/**
 * The response for a `generate_voice` request, indicating that the voice audio playback has finished.
 * This event is emitted by the host after successfully generating and playing the voice audio for the provided text using the specified TTS voice.
 * Note: this event is emitted AFTER the playback has completely finished, so the client can use this event to trigger any follow-up actions or UI updates after the voice playback is done.
 */
export interface LaylaApiEvent_onFinishedSpeaking {
  event: 'on_finished_speaking';
  data: null; // no additional data is needed for this event
}

/**
 * The response for a `get_inference_engines` request, containing an array of all available inference engine names.
 * This event is emitted by the host after successfully retrieving the list of inference engines.
 */
export interface LaylaApiEvent_onGetInferenceEnginesResponse {
  event: 'on_get_inference_engines_response';
  data: {
    engines: string[]; // an array of all available inference engine names
  };
}

/**
 * The response for a `set_inference_engine` request, indicating whether the specified inference engine was set successfully.
 * This event is emitted by the host after attempting to set the inference engine.
 */
export interface LaylaApiEvent_onSetInferenceEngineResponse {
  event: 'on_set_inference_engine_response';
  data: {
    success: boolean; // indicates whether the inference engine was set successfully
    engineName: string | null; // the name of the inference engine that was set, or null if the default engine was used
  };
}

/**
 * The response for a `get_execution_context` request, containing the current execution context of the mini-app.
 * The execution context can include information about the current state of the host, such as current character, session, or other relevant data.
 * If the mini-app is running standalone as a top-level mini-app without any character or session context, the `data` field will be null.
 */
export interface LaylaApiEvent_onGetExecutionContextResponse {
  event: 'on_get_execution_context_response';
  data: LaylaExecutionContext | null; // the current execution context, or null if the mini-app is running standalone as a top-level mini-app without any character or session context
}

/**
 * The contextual event emitted by the host when a new chat message is added to the chat context (e.g., when a user sends a message or when the assistant generates a response).
 * This event is only emitted by the host when the mini-app is running in a character chat context.
 * It provides the new chat message along with the associated character ID, session ID, and timestamp.
 */
export interface LaylaApiEvent_onChatContextNewMessage {
  event: 'on_chat_context_new_message';
  data: {
    message: LaylaChatMessage;
    character_id: string;
    session_id: string;
    timestamp: number;
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
  | LaylaApiEvent_onCreateOrUpdateMemoriesResponse
  | LaylaApiEvent_onScheduledChatMessage
  | LaylaApiEvent_onCancelScheduledChatMessage
  | LaylaApiEvent_onGetScheduledChatMessagesResponse
  | LaylaApiEvent_onGetPersonaResponse
  | LaylaApiEvent_onGetTTSVoicesResponse
  | LaylaApiEvent_onGetInferenceEnginesResponse
  | LaylaApiEvent_onSetInferenceEngineResponse
  | LaylaApiEvent_onFinishedSpeaking
  | LaylaApiEvent_onGetExecutionContextResponse
  | LaylaApiEvent_onChatContextNewMessage;
