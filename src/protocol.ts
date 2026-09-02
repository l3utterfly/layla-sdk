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

export type LaylaChatRole = 'system' | 'user' | 'assistant';

/** An OpenAI-style chat message. */
export interface LaylaChatMessage {
  role: LaylaChatRole;
  content: string | null;
  name?: string;
  image_base64?: string; // optional base64-encoded image (including the data URI prefix) sent to the LLM
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
  entries: {
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
  }[];
}

export interface LaylaExecutionContext {
  app_version: string; // the current version of the Layla app
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
  };
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
    model_id?: string; // optional model ID to use for image generation (if not provided, the host will use the default model)
  };
}

/**
 * Ask the host for the list of available image generation models. The host should respond with an `on_get_image_generation_models_response` event containing an array of model names.
 * The host will only return image models that are immediately available for use (so this will not include models that are not downloaded)
 */
export interface LaylaApiGetImageGenerationModels {
  cmd: 'get_image_generation_models';
  data: null; // no additional data is needed for this request
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
  };
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
  };
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
}

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
  };
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
 * The host will generate the audio and automatically play it on device. The host will emit an `on_finished_speaking` event when the playback has finished.
 * Developer note:
 *   - the host handles queuing of multiple `generate_voice` requests WITH THE SAME `ttsVoiceId`, so the client does not need to manage queuing or waiting for playback to finish before sending the next request. The host will ensure that each request is processed in order and that the `on_finished_speaking` event is emitted after each playback completes.
 *   - if a different `ttsVoiceId` is used in a subsequent request, this incurs a small performance penalty as the host needs to swap TTS models. Additionally, currently queued voices will be cancelled and playback stopped.
 */
export interface LaylaApiGenerateVoice {
  cmd: 'generate_voice';
  data: {
    ttsVoiceId: string | null; // if null, use the default global TTS voice
    text: string;
  };
}

/**
 * Ask the host to generate voice audio for the provided text using the specified TTS voice and save it to a file.
 * The host will generate the audio and save it to a .wav or .mp3 file. The host will respond with `on_generate_voice_to_file_response` event containing the base64-encoded audio data (including the data URI prefix) if the generation was successful, or an error message if there was an error during the generation process.
 */
export interface LaylaApiGenerateVoiceToFile {
  cmd: 'generate_voice_to_file';
  data: {
    ttsVoiceId: string | null; // if null, use the default global TTS voice
    text: string;
    save: boolean; // if true, the host will save the generated audio to a file and return the file name (with extension) in the response. If false, the host will return the base64-encoded audio data in the response.
  };
}

/**
 * Ask the host to stop any in-progress voice audio playback.
 * The host will immediately stop the playback and emit an `on_finished_speaking` event to indicate that the playback has been stopped.
 */
export interface LaylaApiStopSpeaking {
  cmd: 'stop_speaking';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host for the list of available inference engines.
 * The host should respond with an `on_get_inference_engines_response` event containing an array of inference engines names.
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
 * Ask the host to start the background audio player and queue the provided audio files for playback.
 * There is no response event for this request. The host should start the background audio player and queue the provided audio files for playback in the order they are provided.
 * Starting the player while another queue is already playing replaces that queue entirely.
 */
export interface LaylaApiStartBackgroundAudioPlayer {
  cmd: 'start_background_audio_player';
  data: {
    queueAudioFiles: string[]; // an array of audio file paths (local or remote) to queue for playback in the background audio player (local paths are resolved from the custom mini-app root, so a simple filename.ext is sufficient)
    metadata?: {
      // optional track info shown on the lock screen and in the media notification
      title?: string;
      artist?: string;
      albumTitle?: string;
      artworkUrl?: string; // must be a remote https url
    };
  };
}

/**
 * Ask the host to stop the background audio player, clear the queue and release the player.
 * There is no response event for this request. Playback cannot be resumed after this; use pause_background_audio_player if playback should continue later.
 */
export interface LaylaApiStopBackgroundAudioPlayer {
  cmd: 'stop_background_audio_player';
  data: null;
}

/**
 * Ask the host to pause the background audio player at its current position.
 * There is no response event for this request. The queue and playback position are retained. Does nothing if no player is active.
 */
export interface LaylaApiPauseBackgroundAudioPlayer {
  cmd: 'pause_background_audio_player';
  data: null;
}

/**
 * Ask the host to resume the background audio player from its current position.
 * There is no response event for this request. Does nothing if no player is active.
 */
export interface LaylaApiResumeBackgroundAudioPlayer {
  cmd: 'resume_background_audio_player';
  data: null;
}

/**
 * Ask the host to skip to another track in the background audio player queue.
 * There is no response event for this request, but the host emits a background_audio_track_changed event once the track changes.
 * If index is omitted the host advances to the next track; at the end of the queue this does nothing. Does nothing if no player is active.
 */
export interface LaylaApiSkipBackgroundAudioTrack {
  cmd: 'skip_background_audio_track';
  data: {
    index?: number; // zero-based index of the track to skip to, clamped to the queue length, if null, skip to next
  };
}

/**
 * Ask the host to start listening for speech input using the device's microphone.
 * The host should respond with an `on_stt_listening_started` event indicating whether the speech-to-text (STT) service was started successfully or if there was an error starting the service.
 */
export interface LaylaApiSTTStartListening {
  cmd: 'stt_start_listening';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host to stop listening for speech input and terminate the speech-to-text (STT) service.
 * The host should respond with an `on_stt_listening_stopped` event indicating whether the STT service was stopped successfully or if there was an error stopping the service.
 */
export interface LaylaApiSTTStopListening {
  cmd: 'stt_stop_listening';
  data: null; // no additional data is needed for this request
}

/**
 * Ask the host to execute a SQL query against a local sqlite database. This database is not shared with the host app; it is a private database created for the API caller.
 * The host should respond with an `on_execute_sql_response` event containing the query results, or 'on_error' if there was an error executing the query.
 */
export interface LaylaApiExecuteSql {
  cmd: 'execute_sql';
  data: {
    query: string;
    params?: any[];
  };
}

/**
 * Ask the host to generate music using the Ace-Step music generation model.
 * The host should respond with an `on_ace_step_generate_response` event containing the generated music base64 data (including the data URI prefix), or 'on_error' if there was an error during the generation process.
 * The host emits `on_ace_step_generate_progress` events during the generation process to indicate the current status of the music generation.
 */
export interface LaylaApiAceStepGenerate {
  cmd: 'ace_step_generate';
  data: {
    prompt: string;
    lyrics?: string;
    duration?: number; // optional duration in seconds for the generated music (default is 30 seconds)
  }
}

/**
 * One raw ACE-Step request. Mirrors the engine's own `AceRequest`, and is the
 * shape passed to and returned from every `ace_step_*` raw command below.
 *
 * Every field is optional except `caption`, which the `ace_step_lm` and
 * `ace_step_synth` passes require; `ace_step_understand` and `ace_step_vae` read
 * only the handful of fields noted on each command and accept an empty object.
 * Unset fields fall back to the model's own defaults, so a caller only sets what
 * it wants to override. Unknown fields are passed through untouched, which is
 * what lets an enriched request returned by `ace_step_lm` or
 * `ace_step_understand` be handed straight back to `ace_step_synth`.
 */
export interface LaylaApiAceStepRequest {
  /** Style / genre / mood prompt. Required by the lm and synth passes. */
  caption?: string;
  lyrics?: string;
  /** Python-compatible code string ("3101,11837,..."); empty means text2music. */
  audio_codes?: string;
  bpm?: number;
  /** Target track length in seconds. */
  duration?: number;
  keyscale?: string;
  timesignature?: string;
  vocal_language?: string;
  /** Fixed seed; -1 (or unset) for a random one. */
  seed?: number;
  /** LM pass mode: 'generate' (default) | 'inspire' | 'format'. */
  lm_mode?: string;
  /** Number of enriched variants the lm pass produces (1..9). */
  lm_batch_size?: number;
  lm_temperature?: number;
  lm_cfg_scale?: number;
  lm_top_p?: number;
  lm_top_k?: number;
  lm_negative_prompt?: string;
  lm_seed?: number;
  use_cot_caption?: boolean;
  /** DiT inference steps (turbo ~8, sft ~50). 0/unset auto-detects. */
  inference_steps?: number;
  guidance_scale?: number;
  shift?: number;
  /** DiT solver: 'euler' | 'sde' | 'dpm3m' | 'stork4'. */
  solver?: string;
  task_type?: string;
  track?: string;
  /** 'mp3' | 'wav16' | 'wav24' | 'wav32'. A bare 'wav' is rejected. */
  output_format?: string;
  mp3_bitrate?: number;
  peak_clip?: number;
  [key: string]: unknown;
}

/**
 * Ask the host to run the ACE-Step LM pass on its own — the raw equivalent of the
 * engine's `/lm` endpoint, and the first half of what `ace_step_generate` does.
 * Enriches one request into metadata + lyrics (+ audio_codes in 'generate' mode)
 * without rendering any audio; feed a result into `ace_step_synth` to render it.
 *
 * The host should respond with an `on_ace_step_lm_response` event, or 'on_error'
 * if the pass failed. `on_ace_step_generate_progress` events are emitted while
 * it runs.
 */
export interface LaylaApiAceStepLm {
  cmd: 'ace_step_lm';
  data: {
    /** Request to enrich. `caption` is required. */
    request: LaylaApiAceStepRequest;
    /** Accepted for symmetry — the LM pass always runs on CPU. */
    use_gpu?: boolean;
  };
}

/**
 * Ask the host to run the ACE-Step synth pass on its own — the raw equivalent of
 * the engine's `/synth` endpoint, and the second half of `ace_step_generate`.
 * Runs Text-Encoder + DiT + VAE and returns the rendered track inline.
 *
 * The container follows `request.output_format` ('mp3' | 'wav16' | 'wav24' |
 * 'wav32'; a bare 'wav' is rejected). Nothing is written to the app's storage —
 * pass the returned data to `save_file` to keep it.
 *
 * The host should respond with an `on_ace_step_synth_response` event, or
 * 'on_error' if the pass failed. `on_ace_step_generate_progress` events are
 * emitted while it runs.
 */
export interface LaylaApiAceStepSynth {
  cmd: 'ace_step_synth';
  data: {
    /** Request to render — normally one entry from an `ace_step_lm` response.
     *  `caption` is required. */
    request: LaylaApiAceStepRequest;
    /** Run the DiT on the GPU (OpenCL on Android) with CPU fallback. */
    use_gpu?: boolean;
    /** Flash attention for the synth pass (trades quality for speed on CPU). */
    use_flash_attn?: boolean;
    /** Latent frames per VAE decode tile; lower cuts peak memory. */
    vae_tile_size?: number;
  };
}

/**
 * Ask the host to analyze an existing track — the raw equivalent of the engine's
 * `/understand` endpoint. Runs the reverse pipeline (VAE encode -> FSQ tokenize
 * -> LM) and returns what the track "is": caption, lyrics, metadata and
 * audio_codes, as a request that can be handed straight to `ace_step_synth` to
 * re-render, cover or continue it.
 *
 * Provide exactly one source: `audio_data_base64`, or `src_latents_base64` from
 * a previous `ace_step_vae` encode / `ace_step_understand` call (which skips the
 * VAE encode entirely and is much faster on an already-analyzed track). Latents
 * win when both are given.
 *
 * The host should respond with an `on_ace_step_understand_response` event, or
 * 'on_error' if the pass failed. `on_ace_step_generate_progress` events are
 * emitted while it runs.
 */
export interface LaylaApiAceStepUnderstand {
  cmd: 'ace_step_understand';
  data: {
    /** Track to analyze (WAV or MP3, any sample rate, max 10 minutes), base64
     *  encoded. The data URI prefix is optional; the format is detected from the
     *  bytes, not from any declared mime type. */
    audio_data_base64?: string;
    /** Pre-encoded latents to analyze instead, base64 encoded. */
    src_latents_base64?: string;
    /** Return the encoded latents alongside the result so a later call can skip
     *  the VAE encode. Off by default: latents are large, and most callers only
     *  want the analysis. Ignored when `src_latents_base64` supplied the source —
     *  the bytes would be the ones just passed in. */
    return_latents?: boolean;
    /** Sampling params only (lm_temperature, lm_top_p, lm_top_k, lm_seed).
     *  Understand samples colder than generation: left unset, temperature and
     *  top_p become 0.3 / 1.0. */
    request?: LaylaApiAceStepRequest;
    /** Accepted for symmetry — every understand stage runs on CPU. */
    use_gpu?: boolean;
    /** Flash attention for the LM stage. */
    use_flash_attn?: boolean;
    /** Latent frames per VAE encode tile. */
    vae_tile_size?: number;
  };
}

/**
 * Ask the host to run the ACE-Step VAE on its own — the raw equivalent of the
 * engine's `/vae` endpoint. Like that endpoint, this single command travels in
 * whichever direction the input implies, so provide exactly one of:
 *
 *   audio_data_base64  encode: audio in, latents out
 *   latents_base64     decode: latents in, audio out
 *
 * Latents are raw f32 [T, 64] time-major bytes with no header. That format is
 * shared across the whole raw surface: what an encode returns is accepted by
 * this command's decode direction and by `ace_step_understand`'s
 * `src_latents_base64`, so an expensive encode is done once and reused.
 *
 * The host should respond with an `on_ace_step_vae_response` event, or
 * 'on_error' if the pass failed. `on_ace_step_generate_progress` events are
 * emitted while it runs.
 */
export interface LaylaApiAceStepVae {
  cmd: 'ace_step_vae';
  data: {
    /** Audio to encode (WAV or MP3, any sample rate, max 10 minutes), base64
     *  encoded. Mutually exclusive with `latents_base64`. */
    audio_data_base64?: string;
    /** Latents to decode (max 15000 frames / 10 minutes), base64 encoded.
     *  Mutually exclusive with `audio_data_base64`. */
    latents_base64?: string;
    /** Read on the decode direction for `output_format` (which also picks the
     *  returned container), `mp3_bitrate` and `peak_clip`. The encode direction
     *  reads nothing from it. */
    request?: LaylaApiAceStepRequest;
    /** Accepted for symmetry — the VAE is pinned to CPU today. */
    use_gpu?: boolean;
    /** Latent frames per VAE tile; lower cuts peak memory. */
    vae_tile_size?: number;
  };
}

/**
 * Ask the host to list the contents of a directory in the app's private storage.
 * The host should respond with an `on_list_dir_response` event containing an array of file and directory names in the specified path, or 'on_error' if there was an error accessing the directory.
 * The path is relative to the app's private storage directory, and the host ensures that the request does not access files outside of this directory for security reasons.
 */
export interface LaylaApiListDir {
  cmd: 'list_dir';
  data: {
    path: string;   // the directory path to list, relative to the app's private directory
  };
}

/**
 * Ask the host to delete a file or directory in the app's private storage.
 * The host should respond with an `on_delete_file_or_dir_response` event indicating whether the deletion was successful or if there was an error during the deletion process.
 * The path is relative to the app's private storage directory, and the host ensures that the request does not delete files outside of this directory for security reasons.
 */
export interface LaylaApiDeleteFileOrDir {
  cmd: 'delete_file_or_dir';
  data: {
    path: string;   // the path of the file or directory to delete, relative to the app's private directory
  };
}

/**
 * A request command (anything that opens a job and expects events back).
 * Add new one-shot commands here. `cancel` is not a request — it's a control
 * signal for an already-open job — so it lives outside this union.
 */
export type BaseApiRequest =
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
  | LaylaApiGetExecutionContext
  | LaylaApiGenerateVoiceToFile
  | LaylaApiStartBackgroundAudioPlayer
  | LaylaApiStopBackgroundAudioPlayer
  | LaylaApiPauseBackgroundAudioPlayer
  | LaylaApiResumeBackgroundAudioPlayer
  | LaylaApiSkipBackgroundAudioTrack
  | LaylaApiGetImageGenerationModels
  | LaylaApiSTTStartListening
  | LaylaApiSTTStopListening
  | LaylaApiExecuteSql
  | LaylaApiAceStepGenerate
  | LaylaApiAceStepLm
  | LaylaApiAceStepSynth
  | LaylaApiAceStepUnderstand
  | LaylaApiAceStepVae
  | LaylaApiListDir
  | LaylaApiDeleteFileOrDir;

/* ---- RN -> Web events ------------------------------------------------------ */

/** Stream finished. */
export interface LaylaApiEvent_onMsgEnd {
  event: 'on_message_end';
  data: {
    msg: string;
  } | null; // null if there was an error and no final message content is available
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
    sessions: {
      session_id: string;
      last_message_timestamp: number;
      last_message_content: string;
    }[];
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
  };
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
  };
}

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

export interface LaylaApiEvent_onGenerateVoiceToFileResponse {
  event: 'on_generate_voice_to_file_response';
  data: {
    success: boolean; // indicates whether the voice audio was generated and saved to a file successfully
    audio_data_base64: string | null; // the generated voice audio data encoded in base64 (including the data URI prefix) if successful, or null if there was an error during generation or save = true
    filename: string | null; // the filename (with extension) of the saved audio file if successful, or null if there was an error during generation or save = false
    message?: string; // optional message providing additional information about the generation operation (e.g., error details if success is false)
  };
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
  data: LaylaExecutionContext; // the current execution context
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

/**
 * The contextual event emitted by the host when the active sentiment changes in the surrounding character chat.
 * This event is only emitted by the host when the mini-app is running in a character chat context.
 * It provides the sentiment category currently selected by the host.
 */
export interface LaylaApiEvent_onChatContextSentimentUpdate {
  event: 'on_chat_context_sentiment_update';
  data: {
    sentiment: keyof SentimentValues;
  };
}

/**
 * The contextual event emitted by the host when the character starts speaking in the surrounding character chat.
 * This event is only emitted by the host when the mini-app is running in a character chat context.
 */
export interface LaylaApiEvent_onChatContextStartedSpeaking {
  event: 'on_chat_context_started_speaking';
  data: null; // no additional data is needed for this event
}

/**
 * The contextual event emitted by the host when the character finishes speaking in the surrounding character chat.
 * This event uses the same `on_finished_speaking` event name as TTS playback completion and is included separately here to describe its character chat context.
 */
export interface LaylaApiEvent_onChatContextFinishedSpeaking {
  event: 'on_finished_speaking';
  data: null; // no additional data is needed for this event
}

/**
 * The contextual event emitted by the host when the character starts thinking in the surrounding character chat.
 * This event is only emitted by the host when the mini-app is running in a character chat context.
 */
export interface LaylaApiEvent_onChatContextStartedThinking {
  event: 'on_chat_context_started_thinking';
  data: null; // no additional data is needed for this event
}

/**
 * The event emitted by the host when the background audio player moves to a different track,
 * either because the previous track finished or because of a skip_background_audio_track request.
 */
export interface LaylaApiEvent_onBackgroundAudioTrackChanged {
  event: 'on_background_audio_track_changed';
  data: {
    currentIndex: number; // zero-based index of the track now playing
    previousIndex: number; // zero-based index of the track that was playing before
  };
}

/**
 * The event emitted by the host at a regular interval (roughly once per second) while the background audio player is active.
 * Note that these updates are throttled or suspended entirely while the app is backgrounded, so they must not be used to drive queue logic.
 */
export interface LaylaApiEvent_onBackgroundAudioStatus {
  event: 'on_background_audio_status';
  data: {
    playing: boolean;
    currentIndex: number; // zero-based index of the current track
    currentTime: number; // playback position within the current track, in seconds
    duration: number; // duration of the current track in seconds, or 0 if not yet known
    isLoaded: boolean; // whether the current track has finished loading
  };
}

/**
 * The event emitted by the host when the last track in the queue finishes playing.
 * The player is released at this point, so playback must be restarted with start_background_audio_player.
 */
export interface LaylaApiEvent_onBackgroundAudioFinished {
  event: 'on_background_audio_finished';
  data: null; // no additional data is needed for this event
}

/**
 * The response for a `get_image_generation_models` request, containing an array of all available image generation models with their details.
 * This event is emitted by the host after successfully retrieving the list of image generation models.
 */
export interface LaylaApiEvent_onGetImageGenerationModelsResponse {
  event: 'on_get_image_generation_models_response';
  data: {
    id: string;
    name: string;
    description: string;
  }[]; // an array of all available image generation models with their details
}

/**
 * The event emitted by the host when the speech-to-text (STT) service starts listening for speech input using the device's microphone.
 * This event is emitted in response to a `stt_start_listening` request and indicates that the STT service has started successfully.
 */
export interface LaylaApiEvent_onSTTListeningStarted {
  event: 'on_stt_listening_started';
  data: null; // no additional data is needed for this event
}

/**
 * The event emitted by the host when the speech-to-text (STT) service recognizes speech input and generates a transcript.
 * This event is emitted in response to a `stt_start_listening` request and provides the recognized speech transcript.
 */
export interface LaylaApiEvent_onSTTSpeechRecognized {
  event: 'on_stt_recognised_speech';
  data: {
    transcript: string; // the recognised speech transcript
  };
}

/**
 * The event emitted by the host when the speech-to-text (STT) service stops listening for speech input and terminates the STT service.
 * This event is emitted in response to a `stt_stop_listening` request and indicates that the STT service has stopped successfully.
 */
export interface LaylaApiEvent_onSTTListeningStopped {
  event: 'on_stt_listening_stopped';
  data: null; // no additional data is needed for this event
}

/**
 * The response for an `execute_sql` request, containing the results of the executed SQL query.
 * This event is emitted by the host after successfully executing the SQL query against the local sqlite database.
 * The `rows` field contains the rows returned by the query (empty for write operations), where each row is represented as a column->value map.
 * The `rowsAffected` field indicates the number of rows changed by an INSERT/UPDATE/DELETE operation.
 * The `insertId` field provides the row ID of the last inserted row (0 when not applicable).
 */
export interface LaylaApiEvent_onExecuteSqlResponse {
  event: 'on_execute_sql_response';
  data: {
    /** Rows returned by the query (empty for writes). Each row is a column->value map. */
    rows: any[];
    /** Number of rows changed by an INSERT/UPDATE/DELETE. */
    rowsAffected: number;
    /** Row id of the last inserted row (0 when not applicable). */
    insertId: number;
  };
}

/**
 * The response for an `ace_step_generate` request, containing the generated music audio data encoded in base64 (including the data URI prefix).
 * This event is emitted by the host after successfully generating music using the Ace-Step music generation model.
 */
export interface LaylaApiEvent_onAceStepGenerateResponse {
  event: 'on_ace_step_generate_response';
  data: {
    audio_data_base64: string; // the generated music audio data encoded in base64 (including the data URI prefix)
    message?: string; // optional message providing additional information about the generation operation (e.g., error details if there was an error)
  };
}

/**
 * The response for an `ace_step_lm` request, containing the enriched request(s).
 * One entry per batch variant (`lm_batch_size`, default 1). Each entry is a full
 * request carrying the original caption plus the LM's metadata, lyrics and — in
 * 'generate' mode — audio_codes, and can be passed straight to `ace_step_synth`.
 */
export interface LaylaApiEvent_onAceStepLmResponse {
  event: 'on_ace_step_lm_response';
  data: {
    requests: LaylaApiAceStepRequest[];
  };
}

/**
 * The response for an `ace_step_synth` request, carrying the rendered track.
 * `request` is the request as actually rendered, with the seed resolved, so the
 * same run can be reproduced. Pass `audio_data_base64` to `save_file` to keep
 * the audio, or straight back into `ace_step_understand` / `ace_step_vae`.
 */
export interface LaylaApiEvent_onAceStepSynthResponse {
  event: 'on_ace_step_synth_response';
  data: {
    audio_data_base64: string; // rendered audio, including the data URI prefix
    seed: number; // the resolved seed, so a run can be reproduced
    sample_rate: number; // always 48000
    num_samples: number; // per channel
    duration_seconds: number;
    request: LaylaApiAceStepRequest; // the request as rendered
  };
}

/**
 * The response for an `ace_step_understand` request, describing the analyzed
 * track. `request` carries the caption, lyrics, metadata and audio_codes the LM
 * derived, ready to hand to `ace_step_synth`. `latents_base64` is null unless
 * `return_latents` was set and the source was audio.
 */
export interface LaylaApiEvent_onAceStepUnderstandResponse {
  event: 'on_ace_step_understand_response';
  data: {
    request: LaylaApiAceStepRequest;
    latents_base64: string | null; // including the data URI prefix; null when not returned
    latent_frames: number; // 0 when no latents were returned
    duration_seconds: number;
  };
}

/**
 * The response for an `ace_step_vae` request. `direction` reports which way the
 * pass actually travelled, decided by which input was supplied. On 'encode',
 * `latents_base64` and `latent_frames` are set; on 'decode', `audio_data_base64`
 * and `num_samples` are set. The unused side of each pair is null.
 */
export interface LaylaApiEvent_onAceStepVaeResponse {
  event: 'on_ace_step_vae_response';
  data: {
    direction: 'encode' | 'decode';
    latents_base64: string | null; // encode only; including the data URI prefix
    audio_data_base64: string | null; // decode only; including the data URI prefix
    sample_rate: number; // always 48000
    duration_seconds: number;
    latent_frames: number | null; // encode only; null on decode
    num_samples: number | null; // decode only (per channel); null on encode
  };
}

/**
 * The response for a `list_dir` request, containing an array of file and directory entries in the specified path.
 * This event is emitted by the host after successfully listing the contents of a directory in the app's private storage.
 * Each entry includes the relative path of the directory/file and a boolean indicating whether it is a directory or a file. You can recursively call `list_dir` on any directory entries to explore the directory tree.
 */
export interface LaylaApiEvent_onListDirResponse {
  event: 'on_list_dir_response';
  data: {
    path: string; // the relative path of the directory/file relative to the app's private storage directory
    is_dir: boolean; // true if the path is a directory, false if it is a file
  }[];
}

/**
 * The response for a `delete_file_or_dir` request, indicating the deletion of the specified file or directory was successful.
 * This event is emitted by the host after successfully deleting a file or directory in the app's private storage.
 * The `data` field is null because no additional information is needed for this event. If there was an error during the deletion process, the host should emit an `on_error` event instead of this event.
 */
export interface LaylaApiEvent_onDeleteFileOrDirResponse {
  event: 'on_delete_file_or_dir_response';
  data: null; // no additional data is needed for this event
}

export type BaseApiEvent =
  | LaylaApiEvent_onMsgEnd
  | LaylaApiEvent_onError
  | LaylaApiEvent_onGetCharactersResponse
  | LaylaApiEvent_onGetCharacterImageResponse
  | LaylaApiEvent_onGenerateImageResponse
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
  | LaylaApiEvent_onChatContextNewMessage
  | LaylaApiEvent_onChatContextSentimentUpdate
  | LaylaApiEvent_onChatContextStartedSpeaking
  | LaylaApiEvent_onChatContextStartedThinking
  | LaylaApiEvent_onChatContextFinishedSpeaking
  | LaylaApiEvent_onGenerateVoiceToFileResponse
  | LaylaApiEvent_onBackgroundAudioTrackChanged
  | LaylaApiEvent_onBackgroundAudioStatus
  | LaylaApiEvent_onBackgroundAudioFinished
  | LaylaApiEvent_onGetImageGenerationModelsResponse
  | LaylaApiEvent_onSTTListeningStarted
  | LaylaApiEvent_onSTTSpeechRecognized
  | LaylaApiEvent_onSTTListeningStopped
  | LaylaApiEvent_onExecuteSqlResponse
  | LaylaApiEvent_onAceStepGenerateResponse
  | LaylaApiEvent_onAceStepLmResponse
  | LaylaApiEvent_onAceStepSynthResponse
  | LaylaApiEvent_onAceStepUnderstandResponse
  | LaylaApiEvent_onAceStepVaeResponse
  | LaylaApiEvent_onListDirResponse
  | LaylaApiEvent_onDeleteFileOrDirResponse;
