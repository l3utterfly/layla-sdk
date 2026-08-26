/**
 * mock.ts
 * -------
 * A fake Layla native host for running the SDK OUTSIDE the app (Vite dev server,
 * Storybook, a browser test, etc.). It installs a stand-in
 * `window.ReactNativeWebView` and answers the web->RN commands by dispatching the
 * same `MessageEvent`s the real host would, so the SDK's bridge, queue,
 * streaming, and cancel paths all run for real against it.
 *
 * Usage (Vite — install in dev before you use the SDK):
 *
 *   // main.ts
 *   if (import.meta.env.DEV) {
 *     const { installLaylaMock } = await import('layla-sdk/mock');
 *     installLaylaMock({ debug: true });
 *   }
 *
 * Install BEFORE the SDK posts its first message; otherwise the bridge sees no
 * host and rejects with LaylaBridgeUnavailableError.
 */

import type { LaylaApiEvent, LaylaApiRequest } from './interface';
import type {
  LaylaApiEvent_onBackgroundAudioFinished,
  LaylaApiEvent_onBackgroundAudioStatus,
  LaylaApiEvent_onBackgroundAudioTrackChanged,
  LaylaApiEvent_onChatContextFinishedSpeaking,
  LaylaApiEvent_onChatContextNewMessage,
  LaylaApiEvent_onChatContextSentimentUpdate,
  LaylaApiEvent_onChatContextStartedSpeaking,
  LaylaApiEvent_onChatContextStartedThinking,
  LaylaApiEvent_onGetChatSessionsResponse,
  LaylaApiEvent_onExecuteSqlResponse,
  LaylaApiEvent_onGetImageGenerationModelsResponse,
  LaylaApiEvent_onSTTSpeechRecognized,
  LaylaCharacter,
  LaylaChatHistoryEntry,
  LaylaChatMessage,
  LaylaMemory,
  LaylaPersona,
  LaylaScheduledChatMessage,
  LaylaTTSVoice,
  LaylaExecutionContext,
  TavernCardV2,
} from './protocol';
import { makeMockChatHistory } from './mock-data/chat-history';

type MockReply =
  | string
  | string[]
  | Iterable<string>
  | AsyncIterable<string>;

type MockChatHistorySource =
  | LaylaChatHistoryEntry[]
  | Record<string, LaylaChatHistoryEntry[]>;

type MockMemorySource =
  | LaylaMemory[]
  | Record<string, LaylaMemory[]>;

type MockPersonaSource = Record<string, LaylaPersona>;

type MockFileSource = Record<string, string>;

type MockScheduledChatMessageSource = LaylaScheduledChatMessage[];

type MockChatSession =
  LaylaApiEvent_onGetChatSessionsResponse['data']['sessions'][number];

type MockImageGenerationModel =
  LaylaApiEvent_onGetImageGenerationModelsResponse['data'][number];

type MockExecuteSqlResult = LaylaApiEvent_onExecuteSqlResponse['data'];

export interface LaylaMockOptions {
  /**
   * Produce the assistant reply for a `send_message`. Return a string (which the
   * mock tokenises and streams), an array of pre-split tokens, or an
   * (async) iterable of tokens for full control over timing/content. May be
   * async. Defaults to a canned reply that echoes the last user message.
   */
  respond?: (messages: LaylaChatMessage[]) => MockReply | Promise<MockReply>;
  /** Cards returned by `get_characters`. Defaults to two sample cards. */
  characters?: LaylaCharacter[];
  /**
   * Initial messages used by chat session/history reads and message saves.
   * Pass an array of all messages, or a record of message arrays keyed by
   * session id, character id, or any app-specific label.
   */
  chatHistory?: MockChatHistorySource;
  /**
   * Initial memories used by memory list and create/update calls.
   * Pass an array of all memories, or a record of memory arrays keyed by
   * character id or any app-specific label.
   */
  memories?: MockMemorySource;
  /** Default persona returned by `get_persona` when no character id is passed. */
  persona?: LaylaPersona;
  /** Character-specific personas keyed by character id. */
  personas?: MockPersonaSource;
  /**
   * Initial private app files used by `utils.readFile`.
   * Values may be raw base64 strings or ready-to-use data URIs.
   */
  files?: MockFileSource;
  /**
   * Initial scheduled chat messages used by scheduled-message APIs.
   */
  scheduledChatMessages?: MockScheduledChatMessageSource;
  /**
   * Inference engines returned by `chat.getInferenceEngines()`.
   * Defaults to three sample engines.
   */
  inferenceEngines?: string[];
  /**
   * Context returned by `contextual.getExecutionContext()`.
   * Defaults to a mock app version with no active character or session.
   */
  executionContext?: LaylaExecutionContext;
  /** TTS voices returned by `tts.getVoices()`. Defaults to two sample voices. */
  ttsVoices?: LaylaTTSVoice[];
  /**
   * Transcript the mock emits as an `on_stt_recognised_speech` event shortly
   * after `stt.startListening()` succeeds, so listeners fire without extra
   * wiring. Set to `null` to disable the automatic event and drive recognised
   * speech manually via {@link LaylaMockHandle.emitSTTSpeechRecognized}.
   * Defaults to a sample phrase.
   */
  sttTranscript?: string | null;
  /**
   * Image generation models returned by `images.getImageGenerationModels()`.
   * Defaults to two sample models.
   */
  imageGenerationModels?: MockImageGenerationModel[];
  /**
   * Handle `db.executeSql(query, params)` calls. Return the query result the
   * mock should reply with (`rows`, `rowsAffected`, `insertId`). May be async,
   * so you can back it with an in-browser SQL engine (e.g. sql.js) for realistic
   * local testing. The browser mock has no real database, so when this is
   * omitted every query resolves to an empty result
   * (`{ rows: [], rowsAffected: 0, insertId: 0 }`).
   */
  executeSql?: (
    query: string,
    params: unknown[],
  ) => MockExecuteSqlResult | Promise<MockExecuteSqlResult>;
  /** Delay before the first event of a response (simulated latency). Default 150ms. */
  latencyMs?: number;
  /** Delay between streamed tokens. Default 40ms. */
  tokenDelayMs?: number;
  /** 0..1 probability that a request fails with on_error, for testing error paths. Default 0. */
  errorRate?: number;
  /** Log every web->RN command and RN->web event to the console. */
  debug?: boolean;
}

export interface LaylaMockHandle {
  /** Emit a background-audio track change for listener testing. */
  emitBackgroundAudioTrackChanged(
    data: LaylaApiEvent_onBackgroundAudioTrackChanged['data'],
  ): void;
  /** Emit a background-audio status update for listener testing. */
  emitBackgroundAudioStatus(
    data: LaylaApiEvent_onBackgroundAudioStatus['data'],
  ): void;
  /** Emit background-audio completion for listener testing. */
  emitBackgroundAudioFinished(): void;
  /** Emit a host-pushed message event for contextual listener testing. */
  emitChatContextNewMessage(
    data: LaylaApiEvent_onChatContextNewMessage['data'],
  ): void;
  /** Emit a host-pushed sentiment update for contextual listener testing. */
  emitChatContextSentimentUpdate(
    data: LaylaApiEvent_onChatContextSentimentUpdate['data'],
  ): void;
  /** Emit a host-pushed speaking-start event for contextual listener testing. */
  emitChatContextStartedSpeaking(): void;
  /** Emit a host-pushed speaking-finished event for contextual listener testing. */
  emitChatContextFinishedSpeaking(): void;
  /** Emit a host-pushed thinking-start event for contextual listener testing. */
  emitChatContextStartedThinking(): void;
  /** Emit a host-pushed recognised-speech event for STT listener testing. */
  emitSTTSpeechRecognized(
    data: LaylaApiEvent_onSTTSpeechRecognized['data'],
  ): void;
  /** Remove the fake bridge and restore whatever was there before. */
  uninstall(): void;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mockFileStoragePrefix = '@layla-network/sdk:mock:file:';
const mockVoiceAudioDataUri =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const mockVoiceFilename = 'mock-voice.wav';
// The real host reports each track's true audio duration and ticks status
// roughly once per second. The mock invents a short fixed duration and ticks a
// little faster so a queue plays through quickly and the scrubber stays smooth.
const mockTrackDurationSec = 6;
const mockAudioTickMs = 250;

const mockFileStorageKey = (filename: string): string =>
  `${mockFileStoragePrefix}${filename}`;

const storageErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'Browser localStorage is not available.';

const writeStoredFile = (filename: string, contentBase64: string): void => {
  window.localStorage.setItem(mockFileStorageKey(filename), contentBase64);
};

const readStoredFile = (filename: string): string | undefined => {
  const contentBase64 = window.localStorage.getItem(mockFileStorageKey(filename));
  return contentBase64 === null ? undefined : contentBase64;
};

const base64ToBytes = (contentBase64: string): Uint8Array<ArrayBuffer> => {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const downloadFile = (
  filename: string,
  bytes: Uint8Array<ArrayBuffer>,
): void => {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Build a valid Character Card V2 with sensible mock defaults. */
export function makeMockCharacter(
  name: string,
  overrides: Partial<TavernCardV2['data']> = {},
): LaylaCharacter {
  return {
    id: `mock-${name.toLowerCase()}`,
    data: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name,
        description: `${name} is a mock character for local testing.`,
        personality: 'friendly, helpful',
        scenario: '',
        first_mes: `Hi, I'm ${name}.`,
        mes_example: '',
        creator_notes: 'Generated by layla mock.',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: ['mock'],
        creator: 'layla-mock',
        character_version: '1.0',
        extensions: {},
        ...overrides,
      },
    }
  };
}

export function installLaylaMock(options: LaylaMockOptions = {}): LaylaMockHandle {
  if (typeof window === 'undefined') {
    throw new Error(
      'installLaylaMock needs a browser-like environment (window). ' +
      'In Node, run your test under jsdom or happy-dom.',
    );
  }

  const latencyMs = options.latencyMs ?? 150;
  const tokenDelayMs = options.tokenDelayMs ?? 40;
  const errorRate = options.errorRate ?? 0;
  const characters =
    options.characters ?? [makeMockCharacter('Aria'), makeMockCharacter('Kai')];
  const defaultChatHistory = characters
    .flatMap((character) => makeMockChatHistory(character.id))
    .map((entry, index) => ({ ...entry, id: index + 1 }));
  const defaultMemories = characters.flatMap((character, characterIndex) =>
    [0, 1].map((memoryIndex) => ({
      id: characterIndex * 2 + memoryIndex + 1,
      character_id: character.id,
      session_id: `mock-session-${characterIndex}`,
      rawText:
        memoryIndex === 0
          ? `${character.data.data.name} likes testing mini-app memory flows.`
          : `${character.data.data.name} keeps mock memories newest first.`,
      timestamp: Date.now() - (characterIndex * 2 + memoryIndex) * 60_000,
      summary:
        memoryIndex === 0
          ? 'Enjoys testing memory flows.'
          : 'Uses newest-first mock memories.',
      knowledgeGraphJSON: null,
    })),
  );
  const defaultPersona: LaylaPersona = {
    name: 'Mock User',
    description: 'A default mock persona for local browser development.',
  };
  const defaultPersonas: MockPersonaSource = Object.fromEntries(
    characters.map((character) => [
      character.id,
      {
        name: character.data.data.name,
        description:
          character.data.data.description ||
          character.data.data.personality ||
          `${character.data.data.name} is a mock persona.`,
      },
    ]),
  );
  const ttsVoices = options.ttsVoices ?? [
    {
      id: 'mock-voice-aria',
      type: 'mock',
      tags: ['female', 'warm', 'local-dev'],
      name: 'Mock Aria',
    },
    {
      id: 'mock-voice-kai',
      type: 'mock',
      tags: ['male', 'calm', 'local-dev'],
      name: 'Mock Kai',
    },
  ];
  const sttTranscript =
    options.sttTranscript === undefined
      ? 'Hello Layla, this is a mock speech transcript.'
      : options.sttTranscript;
  const imageGenerationModels = options.imageGenerationModels ?? [
    {
      id: 'mock-image-model-fast',
      name: 'Mock Turbo',
      description: 'A fast, low-step mock image model for local development.',
    },
    {
      id: 'mock-image-model-quality',
      name: 'Mock Diffusion XL',
      description: 'A higher-quality mock image model for local development.',
    },
  ];

  // The single in-flight generation, mirroring the SDK's one-active-job model.
  let current: { cancelled: boolean } | null = null;
  let currentSpeech: { cancelled: boolean } | null = null;
  let backgroundAudio: {
    queueAudioFiles: string[];
    currentIndex: number;
    playing: boolean;
    currentTime: number;
    duration: number;
  } | null = null;
  let backgroundAudioTimer: ReturnType<typeof setInterval> | null = null;

  const log = (...a: unknown[]) => {
    if (options.debug) console.log('[layla-mock]', ...a);
  };

  /** RN -> web: dispatch an event exactly the way the WebView host does. */
  const emit = (event: LaylaApiEvent): void => {
    log('RN->web', event);
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  };

  const emitError = (message: string) =>
    emit({ event: 'on_error', data: { message } });

  const shouldError = () => errorRate > 0 && Math.random() < errorRate;

  const tokenize = (text: string): string[] =>
    text.match(/\S+\s*/g) ?? (text ? [text] : []);

  const defaultReply = (messages: LaylaChatMessage[]): string => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const said = lastUser?.content ?? '(nothing)';
    const image = lastUser?.image_base64
      ? ' You also attached an image.'
      : '';
    return (
      `This is a mock Layla response. You said: "${said}".${image} ` +
      `Tokens stream one at a time so you can exercise your streaming UI, ` +
      `cancellation, and the final-content promise.`
    );
  };

  async function* tokenSource(
    messages: LaylaChatMessage[],
  ): AsyncGenerator<string> {
    const produced = options.respond
      ? await options.respond(messages)
      : defaultReply(messages);

    if (typeof produced === 'string') {
      yield* tokenize(produced);
      return;
    }
    if (Array.isArray(produced)) {
      yield* produced;
      return;
    }
    if (produced && typeof produced === 'object') {
      if (Symbol.asyncIterator in produced) {
        yield* produced as AsyncIterable<string>;
        return;
      }
      if (Symbol.iterator in produced) {
        yield* produced as Iterable<string>;
      }
    }
  }

  async function handleSend(messages: LaylaChatMessage[]): Promise<void> {
    const gen = { cancelled: false };
    current = gen;
    try {
      await delay(latencyMs);
      if (gen.cancelled) return; // cancel ack already emitted

      if (shouldError()) {
        emitError('Simulated model error');
        return;
      }

      let snapshot = '';
      for await (const delta of tokenSource(messages)) {
        if (gen.cancelled) return;
        snapshot += delta;
        emit({ event: 'on_message', data: { msg: snapshot, delta } });
        await delay(tokenDelayMs);
        if (gen.cancelled) return;
      }
      emit({ event: 'on_message_end', data: { msg: snapshot } });
    } finally {
      if (current === gen) current = null;
    }
  }

  function handleCancel(): void {
    // Native contract: stop generating, then send the terminating on_message_end
    // that the SDK waits on before starting the next queued request. Emit it
    // asynchronously — a real RN bridge never delivers events synchronously
    // inside postMessage, and doing so here would re-enter the SDK's bridge.
    if (current && !current.cancelled) {
      current.cancelled = true;
      queueMicrotask(() => emit({ event: 'on_message_end', data: null }));
    }
  }

  async function handleGetCharacters(data: { offset: number; limit: number }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated characters error');
      return;
    }

    const { offset, limit } = data;
    emit({
      event: 'on_get_characters_response',
      data: characters.slice(offset, offset + limit),
    });
  }

  async function handleGetCharacterImage(data: { character_id: string }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated character image error');
      return;
    }
    // This mock doesn't support images, but we have to return something valid.
    emit({
      event: 'on_get_character_image_response',
      data: {
        character_id: data.character_id,
        image_data_base64: 'https://picsum.photos/id/237/200/300',    // we return a url for mock, since we usually use this as the "src" of an <img> tag, it should work fine as a mock
      },
    });
  }

  const flattenChatHistorySource = (
    source: MockChatHistorySource,
  ): LaylaChatHistoryEntry[] =>
    Array.isArray(source) ? source : Object.values(source).flat();

  const chatHistory = flattenChatHistorySource(
    options.chatHistory ?? defaultChatHistory,
  ).map((entry) => ({ ...entry }));

  const flattenMemorySource = (
    source: MockMemorySource,
  ): LaylaMemory[] =>
    Array.isArray(source) ? source : Object.values(source).flat();

  const memories = flattenMemorySource(
    options.memories ?? defaultMemories,
  ).map((entry) => ({ ...entry }));
  const persona = { ...(options.persona ?? defaultPersona) };
  const personas: MockPersonaSource = {
    ...defaultPersonas,
    ...(options.personas ?? {}),
  };
  const scheduledChatMessages = (options.scheduledChatMessages ?? []).map(
    (entry) => ({ ...entry }),
  );
  const inferenceEngines = options.inferenceEngines ?? [
    'mock-default',
    'mock-fast',
    'mock-quality',
  ];
  const executionContext: LaylaExecutionContext = options.executionContext ?? {
    app_version: 'mock',
    character: null,
    session_id: null,
  };
  let selectedInferenceEngine: string | null = null;
  try {
    for (const [filename, contentBase64] of Object.entries(options.files ?? {})) {
      writeStoredFile(filename, contentBase64);
    }
  } catch (error) {
    log('unable to seed mock files in localStorage', error);
  }

  async function getChatHistoryEntries(data: {
    session_id: string;
    offset: number;
    limit: number;
  }): Promise<LaylaChatHistoryEntry[]> {
    return chatHistory.filter(
      (entry) => entry.session_id === data.session_id,
    );
  }

  function getChatSessions(characterId: string): MockChatSession[] {
    const bySession = new Map<string, LaylaChatHistoryEntry[]>();

    for (const entry of chatHistory) {
      const session = bySession.get(entry.session_id);
      if (session) session.push(entry);
      else bySession.set(entry.session_id, [entry]);
    }

    return [...bySession.entries()]
      .filter(([, entries]) =>
        entries.some((entry) => entry.character_id === characterId),
      )
      .map(([sessionId, entries]) => {
        const [latest] = [...entries].sort((a, b) => b.timestamp - a.timestamp);

        return {
          session_id: sessionId,
          last_message_timestamp: latest?.timestamp ?? 0,
          last_message_content: latest?.content ?? '',
        };
      })
      .sort((a, b) => b.last_message_timestamp - a.last_message_timestamp);
  }

  async function handleGetChatHistory(data: {
    session_id: string;
    offset: number;
    limit: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated chat history error');
      return;
    }

    const history = await getChatHistoryEntries(data);
    emit({
      event: 'on_get_chat_history_response',
      data: {
        session_id: data.session_id,
        messages: history.slice(data.offset, data.offset + data.limit),
      },
    });
  }

  async function handleSaveChatMessage(
    message: LaylaChatHistoryEntry,
  ): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated save chat message error');
      return;
    }

    const existingIndex =
      message.id > 0
        ? chatHistory.findIndex((entry) => entry.id === message.id)
        : -1;
    const saved =
      message.id > 0
        ? { ...message }
        : {
            ...message,
            id:
              chatHistory.reduce(
                (maxId, entry) => Math.max(maxId, entry.id),
                0,
              ) + 1,
          };

    if (existingIndex >= 0) chatHistory[existingIndex] = saved;
    else chatHistory.push(saved);

    emit({
      event: 'on_save_chat_message_response',
      data: saved,
    });
  }

  async function handleGetImageGenerationModels(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated image generation models error');
      return;
    }

    emit({
      event: 'on_get_image_generation_models_response',
      data: imageGenerationModels.map((model) => ({ ...model })),
    });
  }

  async function handleGenerateImage(_: {
    prompt: string;
    img2img_base64?: string;
    model_id?: string;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated image generation error');
      return;
    }

    // Simulate progress events
    const totalSteps = 5;
    for (let step = 1; step <= totalSteps; step++) {
      await delay(latencyMs);
      emit({
        event: 'on_generate_image_progress',
        data: {
          status: `Generating image... (${step}/${totalSteps})`,
          steps: step,
          total_steps: totalSteps,
        },
      });
    }

    // Emit the final image response (using a placeholder image URL for the mock)
    emit({
      event: 'on_generate_image_response',
      data: {
        image_data_base64: 'https://picsum.photos/200/300', // Placeholder image URL for the mock
      },
    });
  }

  async function handleAceStepGenerate(_: {
    prompt: string;
    lyrics?: string;
    duration?: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated music generation error');
      return;
    }

    // Simulate progress events
    const totalSteps = 5;
    for (let step = 1; step <= totalSteps; step++) {
      await delay(latencyMs);
      emit({
        event: 'on_ace_step_generate_progress',
        data: {
          progress: step / totalSteps,
          status: `Generating music... (${step}/${totalSteps})`,
        },
      });
    }

    // Emit the final music response (using a tiny placeholder WAV for the mock)
    emit({
      event: 'on_ace_step_generate_response',
      data: {
        audio_data_base64: mockVoiceAudioDataUri,
      },
    });
  }

  async function handleUpdateCharacter(data: {
    character_id: string;
    character_data: TavernCardV2;
  }): Promise<void> {
    void data.character_data;
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated character update error');
      return;
    }

    emit({
      event: 'on_update_character_response',
      data: {
        character_id: data.character_id,
      },
    });
  }

  async function handleGetSentiment(_: { text: string }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated sentiment analysis error');
      return;
    }
    
    // This mock doesn't do real sentiment analysis, we return random values for demonstration purposes.
    emit({
      event: 'on_get_sentiment_response',
      data: {
        sentiment_values: {
          admiration: Math.random(),
          amusement: Math.random(),
          anger: Math.random(),
          annoyance: Math.random(),
          approval: Math.random(),
          caring: Math.random(),
          confusion: Math.random(),
          curiosity: Math.random(),
          desire: Math.random(),
          disappointment: Math.random(),
          disapproval: Math.random(),
          disgust: Math.random(),
          embarrassment: Math.random(),
          excitement: Math.random(),
          fear: Math.random(),
          gratitude: Math.random(),
          grief: Math.random(),
          joy: Math.random(),
          love: Math.random(),
          nervousness: Math.random(),
          optimism: Math.random(),
          pride: Math.random(),
          realization: Math.random(),
          relief: Math.random(),
          remorse: Math.random(),
          sadness: Math.random(),
          surprise: Math.random(),
          neutral: Math.random(),
        },
      },
    });
  }

  async function handleGetChatSessions(data: {
    character_id: string;
    offset: number;
    limit: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated chat sessions error');
      return;
    }

    const sessions = getChatSessions(data.character_id);

    emit({
      event: 'on_get_chat_sessions_response',
      data: {
        character_id: data.character_id,
        sessions: sessions.slice(data.offset, data.offset + data.limit),
      },
    });
  }

  async function handleSaveFile(data: {
    filename: string;
    content_base64: string;
    share: boolean;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated file save error');
      return;
    }

    try {
      const bytes = base64ToBytes(data.content_base64);

      if (data.share) {
        downloadFile(data.filename, bytes);
      } else {
        writeStoredFile(data.filename, data.content_base64);
      }

      emit({
        event: 'on_save_file_response',
        data: {
          filename: data.filename,
          success: true,
          message: data.share
            ? 'Downloaded by the browser mock; share sheets are not available in browsers.'
            : 'Saved to browser localStorage.',
        },
      });
    } catch (error) {
      emit({
        event: 'on_save_file_response',
        data: {
          filename: data.filename,
          success: false,
          message:
            error instanceof Error ? error.message : 'Unable to save file.',
        },
      });
    }
  }

  const toDataUri = (contentBase64: string): string =>
    contentBase64.startsWith('data:')
      ? contentBase64
      : `data:application/octet-stream;base64,${contentBase64}`;

  async function handleReadFile(data: {
    filename: string;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated file read error');
      return;
    }

    let contentBase64: string | undefined;
    let message: string | undefined;

    try {
      contentBase64 = readStoredFile(data.filename);
    } catch (error) {
      message = storageErrorMessage(error);
    }

    emit({
      event: 'on_read_file_response',
      data: {
        filename: data.filename,
        content_base64:
          contentBase64 === undefined ? null : toDataUri(contentBase64),
        ...(contentBase64 === undefined
          ? { message: message ?? 'File not found in browser localStorage.' }
          : {}),
      },
    });
  }

  async function handleGetMemories(data: {
    character_id: string;
    offset: number;
    limit: number;
    min_timestamp?: number;
    max_timestamp?: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated memories error');
      return;
    }

    const filtered = memories
      .filter((memory) => memory.character_id === data.character_id)
      .filter((memory) =>
        data.min_timestamp === undefined
          ? true
          : memory.timestamp > data.min_timestamp,
      )
      .filter((memory) =>
        data.max_timestamp === undefined
          ? true
          : memory.timestamp < data.max_timestamp,
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    emit({
      event: 'on_get_memories_response',
      data: {
        character_id: data.character_id,
        memories: filtered.slice(data.offset, data.offset + data.limit),
      },
    });
  }

  async function handleGetTopMemories(data: {
    character_id: string;
    limit: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated top memories error');
      return;
    }

    const topMemories = memories
      .filter((memory) => memory.character_id === data.character_id)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, data.limit);

    emit({
      event: 'on_get_top_memories_response',
      data: {
        character_id: data.character_id,
        memories: topMemories,
      },
    });
  }

  async function handleCreateOrUpdateMemories(
    requestedMemories: LaylaMemory[],
  ): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated create or update memories error');
      return;
    }

    const saved = requestedMemories.map((memory) => {
      const existingIndex =
        memory.id > 0
          ? memories.findIndex((entry) => entry.id === memory.id)
          : -1;
      const savedMemory =
        memory.id > 0
          ? { ...memory }
          : {
              ...memory,
              id:
                memories.reduce(
                  (maxId, entry) => Math.max(maxId, entry.id),
                  0,
                ) + 1,
            };

      if (existingIndex >= 0) memories[existingIndex] = savedMemory;
      else memories.push(savedMemory);

      return savedMemory;
    });

    emit({
      event: 'on_create_or_update_memories_response',
      data: {
        character_id: saved[0]?.character_id ?? '',
        memories: saved,
      },
    });
  }

  async function handleGetPersona(data: {
    character_id: string | null;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated persona error');
      return;
    }

    emit({
      event: 'on_get_persona_response',
      data: {
        character_id: data.character_id,
        persona:
          data.character_id === null
            ? persona
            : personas[data.character_id] ?? persona,
      },
    });
  }

  async function handleScheduledChatMessage(
    message: LaylaScheduledChatMessage,
  ): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated scheduled chat message error');
      return;
    }

    const existingIndex =
      message.id > 0
        ? scheduledChatMessages.findIndex((entry) => entry.id === message.id)
        : -1;
    const scheduled =
      message.id > 0
        ? { ...message }
        : {
            ...message,
            id:
              scheduledChatMessages.reduce(
                (maxId, entry) => Math.max(maxId, entry.id),
                0,
              ) + 1,
          };

    if (existingIndex >= 0) scheduledChatMessages[existingIndex] = scheduled;
    else scheduledChatMessages.push(scheduled);

    emit({
      event: 'on_scheduled_chat_message',
      data: scheduled,
    });
  }

  async function handleGetScheduledChatMessages(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated get scheduled chat messages error');
      return;
    }

    emit({
      event: 'on_get_scheduled_chat_messages_response',
      data: {
        scheduled_messages: [...scheduledChatMessages].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
      },
    });
  }

  async function handleCancelScheduledChatMessage(data: {
    id: number;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated cancel scheduled chat message error');
      return;
    }

    const existingIndex = scheduledChatMessages.findIndex(
      (entry) => entry.id === data.id,
    );
    const success = existingIndex >= 0;
    if (success) scheduledChatMessages.splice(existingIndex, 1);

    emit({
      event: 'on_cancel_scheduled_chat_message',
      data: {
        id: data.id,
        success,
        ...(success
          ? {}
          : { message: 'Scheduled chat message not found in the browser mock.' }),
      },
    });
  }

  async function handleGetTTSVoices(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated TTS voices error');
      return;
    }

    emit({
      event: 'on_get_tts_voices_response',
      data: {
        voices: ttsVoices.map((voice) => ({ ...voice })),
      },
    });
  }

  async function handleGetInferenceEngines(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated inference engines error');
      return;
    }

    emit({
      event: 'on_get_inference_engines_response',
      data: {
        engines: [...inferenceEngines],
      },
    });
  }

  async function handleSetInferenceEngine(data: {
    engineName: string | null;
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated set inference engine error');
      return;
    }

    const success =
      data.engineName === null || inferenceEngines.includes(data.engineName);
    selectedInferenceEngine = success ? data.engineName : null;

    emit({
      event: 'on_set_inference_engine_response',
      data: {
        success,
        engineName: selectedInferenceEngine,
      },
    });
  }

  async function handleGetExecutionContext(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated execution context error');
      return;
    }

    emit({
      event: 'on_get_execution_context_response',
      data: executionContext,
    });
  }

  async function handleGenerateVoice(data: {
    ttsVoiceId: string | null;
    text: string;
  }): Promise<void> {
    void data;
    const speech = { cancelled: false };
    currentSpeech = speech;
    try {
      await delay(latencyMs);
      if (speech.cancelled) return;
      if (shouldError()) {
        emitError('Simulated TTS generation error');
        return;
      }

      emit({
        event: 'on_finished_speaking',
        data: null,
      });
    } finally {
      if (currentSpeech === speech) currentSpeech = null;
    }
  }

  async function handleGenerateVoiceToFile(data: {
    ttsVoiceId: string | null;
    text: string;
    save: boolean;
  }): Promise<void> {
    void data.ttsVoiceId;
    void data.text;
    await delay(latencyMs);

    if (shouldError()) {
      emit({
        event: 'on_generate_voice_to_file_response',
        data: {
          success: false,
          audio_data_base64: null,
          filename: null,
          message: 'Simulated TTS file generation error',
        },
      });
      return;
    }

    if (data.save) {
      try {
        writeStoredFile(mockVoiceFilename, mockVoiceAudioDataUri);
        emit({
          event: 'on_generate_voice_to_file_response',
          data: {
            success: true,
            audio_data_base64: null,
            filename: mockVoiceFilename,
          },
        });
      } catch (error) {
        emit({
          event: 'on_generate_voice_to_file_response',
          data: {
            success: false,
            audio_data_base64: null,
            filename: null,
            message: storageErrorMessage(error),
          },
        });
      }
      return;
    }

    emit({
      event: 'on_generate_voice_to_file_response',
      data: {
        success: true,
        audio_data_base64: mockVoiceAudioDataUri,
        filename: null,
      },
    });
  }

  function handleStopSpeaking(): void {
    if (currentSpeech) currentSpeech.cancelled = true;

    queueMicrotask(() =>
      emit({
        event: 'on_finished_speaking',
        data: null,
      }),
    );
  }

  async function handleSTTStartListening(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated STT start listening error');
      return;
    }

    emit({ event: 'on_stt_listening_started', data: null });

    // Simulate the host recognising a phrase shortly after listening starts, so
    // consumers can exercise their `stt.on('speechRecognized', ...)` handler
    // without wiring the manual emitter. Disabled when `sttTranscript` is null.
    if (sttTranscript === null) return;
    window.setTimeout(() => {
      if (!installed) return;
      emit({
        event: 'on_stt_recognised_speech',
        data: { transcript: sttTranscript },
      });
    }, latencyMs);
  }

  async function handleSTTStopListening(): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated STT stop listening error');
      return;
    }

    emit({ event: 'on_stt_listening_stopped', data: null });
  }

  async function handleExecuteSql(data: {
    query: string;
    params?: unknown[];
  }): Promise<void> {
    await delay(latencyMs);
    if (shouldError()) {
      emitError('Simulated SQL execution error');
      return;
    }

    // The browser mock has no real sqlite. Delegate to the caller-supplied
    // handler when present; otherwise reply with an empty successful result.
    const result: MockExecuteSqlResult = options.executeSql
      ? await options.executeSql(data.query, data.params ?? [])
      : { rows: [], rowsAffected: 0, insertId: 0 };

    emit({
      event: 'on_execute_sql_response',
      data: result,
    });
  }

  function emitBackgroundAudioStatus(): void {
    if (!backgroundAudio) return;
    emit({
      event: 'on_background_audio_status',
      data: {
        playing: backgroundAudio.playing,
        currentIndex: backgroundAudio.currentIndex,
        currentTime: backgroundAudio.currentTime,
        duration: backgroundAudio.duration,
        isLoaded: true,
      },
    });
  }

  function stopBackgroundTicking(): void {
    if (backgroundAudioTimer !== null) {
      clearInterval(backgroundAudioTimer);
      backgroundAudioTimer = null;
    }
  }

  /**
   * Drive the simulated playhead: advance currentTime, emit a status update each
   * tick, auto-advance to the next track when one ends (emitting
   * track_changed), and emit finished when the queue runs out — mirroring how
   * the real host owns queue progression.
   */
  function startBackgroundTicking(): void {
    stopBackgroundTicking();
    backgroundAudioTimer = setInterval(() => {
      if (!backgroundAudio || !backgroundAudio.playing) return;

      backgroundAudio.currentTime += mockAudioTickMs / 1000;
      if (backgroundAudio.currentTime < backgroundAudio.duration) {
        emitBackgroundAudioStatus();
        return;
      }

      const previousIndex = backgroundAudio.currentIndex;
      const nextIndex = previousIndex + 1;
      if (nextIndex < backgroundAudio.queueAudioFiles.length) {
        backgroundAudio.currentIndex = nextIndex;
        backgroundAudio.currentTime = 0;
        emit({
          event: 'on_background_audio_track_changed',
          data: { currentIndex: nextIndex, previousIndex },
        });
        emitBackgroundAudioStatus();
      } else {
        stopBackgroundTicking();
        backgroundAudio = null;
        emit({ event: 'on_background_audio_finished', data: null });
      }
    }, mockAudioTickMs);
  }

  function handleStartBackgroundAudioPlayer(data: {
    queueAudioFiles: string[];
  }): void {
    if (data.queueAudioFiles.length === 0) {
      stopBackgroundTicking();
      backgroundAudio = null;
      return;
    }

    backgroundAudio = {
      queueAudioFiles: [...data.queueAudioFiles],
      currentIndex: 0,
      playing: true,
      currentTime: 0,
      duration: mockTrackDurationSec,
    };
    queueMicrotask(() => {
      emitBackgroundAudioStatus();
      startBackgroundTicking();
    });
  }

  function handleStopBackgroundAudioPlayer(): void {
    stopBackgroundTicking();
    backgroundAudio = null;
  }

  function handlePauseBackgroundAudioPlayer(): void {
    if (!backgroundAudio) return;
    backgroundAudio.playing = false;
    stopBackgroundTicking();
    queueMicrotask(emitBackgroundAudioStatus);
  }

  function handleResumeBackgroundAudioPlayer(): void {
    if (!backgroundAudio) return;
    backgroundAudio.playing = true;
    queueMicrotask(() => {
      emitBackgroundAudioStatus();
      startBackgroundTicking();
    });
  }

  function handleSkipBackgroundAudioTrack(data: { index?: number }): void {
    if (!backgroundAudio) return;

    const previousIndex = backgroundAudio.currentIndex;
    const requestedIndex =
      data.index === undefined ? previousIndex + 1 : Math.trunc(data.index);
    if (
      data.index === undefined &&
      requestedIndex >= backgroundAudio.queueAudioFiles.length
    ) {
      return;
    }
    const currentIndex = Number.isFinite(requestedIndex)
      ? Math.max(
          0,
          Math.min(backgroundAudio.queueAudioFiles.length - 1, requestedIndex),
        )
      : previousIndex;
    if (currentIndex === previousIndex) return;

    backgroundAudio.currentIndex = currentIndex;
    backgroundAudio.currentTime = 0;
    queueMicrotask(() => {
      emit({
        event: 'on_background_audio_track_changed',
        data: { currentIndex, previousIndex },
      });
      emitBackgroundAudioStatus();
    });
  }

  const fakeBridge = {
    postMessage(raw: string): void {
      let msg: LaylaApiRequest;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // not ours
      }
      log('web->RN', msg);
      switch (msg.cmd) {
        case 'send_message':
          void handleSend(msg.data);
          break;
        case 'cancel':
          handleCancel();
          break;
        case 'get_characters':
          void handleGetCharacters(msg.data);
          break;
        case 'get_character_image':
          void handleGetCharacterImage(msg.data);
          break;
        case 'get_chat_history':
          void handleGetChatHistory(msg.data);
          break;
        case 'generate_image':
          void handleGenerateImage(msg.data);
          break;
        case 'get_image_generation_models':
          void handleGetImageGenerationModels();
          break;
        case 'ace_step_generate':
          void handleAceStepGenerate(msg.data);
          break;
        case 'update_character':
          void handleUpdateCharacter(msg.data);
          break;
        case 'get_sentiment':
          void handleGetSentiment(msg.data);
          break;
        case 'get_chat_sessions':
          void handleGetChatSessions(msg.data);
          break;
        case 'save_chat_message':
          void handleSaveChatMessage(msg.data);
          break;
        case 'save_file':
          void handleSaveFile(msg.data);
          break;
        case 'read_file':
          void handleReadFile(msg.data);
          break;
        case 'get_memories':
          void handleGetMemories(msg.data);
          break;
        case 'get_top_memories':
          void handleGetTopMemories(msg.data);
          break;
        case 'create_or_update_memories':
          void handleCreateOrUpdateMemories(msg.data);
          break;
        case 'get_persona':
          void handleGetPersona(msg.data);
          break;
        case 'scheduled_chat_message':
          void handleScheduledChatMessage(msg.data);
          break;
        case 'get_scheduled_chat_messages':
          void handleGetScheduledChatMessages();
          break;
        case 'cancel_scheduled_chat_message':
          void handleCancelScheduledChatMessage(msg.data);
          break;
        case 'get_tts_voices':
          void handleGetTTSVoices();
          break;
        case 'generate_voice':
          void handleGenerateVoice(msg.data);
          break;
        case 'generate_voice_to_file':
          void handleGenerateVoiceToFile(msg.data);
          break;
        case 'stop_speaking':
          handleStopSpeaking();
          break;
        case 'start_background_audio_player':
          handleStartBackgroundAudioPlayer(msg.data);
          break;
        case 'stop_background_audio_player':
          handleStopBackgroundAudioPlayer();
          break;
        case 'pause_background_audio_player':
          handlePauseBackgroundAudioPlayer();
          break;
        case 'resume_background_audio_player':
          handleResumeBackgroundAudioPlayer();
          break;
        case 'skip_background_audio_track':
          handleSkipBackgroundAudioTrack(msg.data);
          break;
        case 'get_inference_engines':
          void handleGetInferenceEngines();
          break;
        case 'set_inference_engine':
          void handleSetInferenceEngine(msg.data);
          break;
        case 'get_execution_context':
          void handleGetExecutionContext();
          break;
        case 'stt_start_listening':
          void handleSTTStartListening();
          break;
        case 'stt_stop_listening':
          void handleSTTStopListening();
          break;
        case 'execute_sql':
          void handleExecuteSql(msg.data);
          break;
        default:
          break;
      }
    },
  };

  const previous = window.ReactNativeWebView;
  if (previous) {
    log('warning: replacing an existing window.ReactNativeWebView');
  }
  window.ReactNativeWebView = fakeBridge;
  log('installed');

  let installed = true;
  return {
    emitBackgroundAudioTrackChanged(data) {
      if (!installed) return;
      emit({ event: 'on_background_audio_track_changed', data });
    },
    emitBackgroundAudioStatus(data) {
      if (!installed) return;
      emit({ event: 'on_background_audio_status', data });
    },
    emitBackgroundAudioFinished() {
      if (!installed) return;
      stopBackgroundTicking();
      backgroundAudio = null;
      const event: LaylaApiEvent_onBackgroundAudioFinished = {
        event: 'on_background_audio_finished',
        data: null,
      };
      emit(event);
    },
    emitChatContextNewMessage(data) {
      if (!installed) return;
      emit({ event: 'on_chat_context_new_message', data });
    },
    emitChatContextSentimentUpdate(data) {
      if (!installed) return;
      emit({ event: 'on_chat_context_sentiment_update', data });
    },
    emitChatContextStartedSpeaking() {
      if (!installed) return;
      const event: LaylaApiEvent_onChatContextStartedSpeaking = {
        event: 'on_chat_context_started_speaking',
        data: null,
      };
      emit(event);
    },
    emitChatContextFinishedSpeaking() {
      if (!installed) return;
      const event: LaylaApiEvent_onChatContextFinishedSpeaking = {
        event: 'on_finished_speaking',
        data: null,
      };
      emit(event);
    },
    emitChatContextStartedThinking() {
      if (!installed) return;
      const event: LaylaApiEvent_onChatContextStartedThinking = {
        event: 'on_chat_context_started_thinking',
        data: null,
      };
      emit(event);
    },
    emitSTTSpeechRecognized(data) {
      if (!installed) return;
      emit({ event: 'on_stt_recognised_speech', data });
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      if (current) current.cancelled = true;
      if (currentSpeech) currentSpeech.cancelled = true;
      stopBackgroundTicking();
      backgroundAudio = null;
      if (previous) window.ReactNativeWebView = previous;
      else delete window.ReactNativeWebView;
      log('uninstalled');
    },
  };
}

export default installLaylaMock;
