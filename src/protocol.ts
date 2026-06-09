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
  character_id: string;
  timestamp: number;
}

/* ---- character cards ------------------------------------------------------- */

export interface LaylaCharacter {
  id: string;
  data: TavernCardV2;
}

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
 * Ask the host for the chat history associated with a specific character ID.
 * The host should respond with an `on_get_chat_history_response` event containing an array of chat messages, each including the role, content, character ID, and timestamp.
 * The messages should be returned in reverse chronological order (newest to oldest).
 */
export interface LaylaApiGetChatHistory {
  cmd: 'get_chat_history';
  data: {
    character_id: string;
    offset: number;
    limit: number;
  };
}

/**
 * A request command (anything that opens a job and expects events back).
 * Add new one-shot commands here. `cancel` is not a request — it's a control
 * signal for an already-open job — so it lives outside this union.
 */
export type LaylaApiRequest =
  LaylaApiSendMessage |
  LaylaApiGetCharacters |
  LaylaApiGetCharacterImage |
  LaylaApiCancel |
  LaylaApiGenerateImage |
  LaylaApiUpdateCharacter |
  LaylaApiGetChatHistory;

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
 * The chat history for a `get_chat_history` request, containing an array of chat messages associated with the specified character ID.
 * Each message includes the role, content, character ID, and timestamp. The host should return the messages in reverse chronological order (newest to oldest).
 */
export interface LaylaApiEvent_onGetChatHistoryResponse {
  event: 'on_get_chat_history_response';
  data: {
    character_id: string;
    messages: LaylaChatHistoryEntry[];
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
  | LaylaApiEvent_onGetChatHistoryResponse;
