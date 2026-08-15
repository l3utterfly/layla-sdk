/**
 * index.ts
 * --------
 * Public barrel. This is the only entry point consumers import from. Internal
 * plumbing (bridge, deferred, one-shot internals) is intentionally not exported.
 *
 *   import { LaylaSDK } from 'layla-sdk';          // named
 *   import LaylaSDK from 'layla-sdk';              // default
 *   import type { TavernCardV2 } from 'layla-sdk'; // types
 *
 * The dev-only mock host lives at './mock' and is not re-exported here, so it
 * never gets pulled into production bundles unless explicitly imported.
 */

// Native wire contract (types only).
export type {
  LaylaChatRole,
  LaylaChatMessage,
  LaylaChatHistoryEntry,
  LaylaScheduledChatMessage,
  LaylaMemory,
  LaylaPersona,
  LaylaTTSVoice,
  LaylaExecutionContext,
  LaylaCharacter,
  TavernCardV2,
  TavernCharacterBook,
  SentimentValues,

  // command types
  LaylaApiSendMessage,
  LaylaApiGetCharacters,
  LaylaApiGetCharacterImage,
  LaylaApiGenerateImage,
  LaylaApiGetImageGenerationModels,
  LaylaApiUpdateCharacter,
  LaylaApiGetChatHistory,
  LaylaApiGetSentiment,
  LaylaApiGetChatSessions,
  LaylaApiSaveChatMessage,
  LaylaApiScheduledChatMessage,
  LaylaApiGetScheduledChatMessages,
  LaylaApiCancelScheduledChatMessage,
  LaylaApiSaveFile,
  LaylaApiReadFile,
  LaylaApiGetMemories,
  LaylaApiGetTopMemories,
  LaylaApiCreateOrUpdateMemories,
  LaylaApiGetPersona,
  LaylaApiGetTTSVoices,
  LaylaApiGenerateVoice,
  LaylaApiGenerateVoiceToFile,
  LaylaApiStopSpeaking,
  LaylaApiGetInferenceEngines,
  LaylaApiSetInferenceEngine,
  LaylaApiGetExecutionContext,
  LaylaApiStartBackgroundAudioPlayer,
  LaylaApiStopBackgroundAudioPlayer,
  LaylaApiPauseBackgroundAudioPlayer,
  LaylaApiResumeBackgroundAudioPlayer,
  LaylaApiSkipBackgroundAudioTrack,
  LaylaApiSTTStartListening,
  LaylaApiCancel,

  // event types
  LaylaApiEvent_onMsgEnd,
  LaylaApiEvent_onError,
  LaylaApiEvent_onGetCharactersResponse,
  LaylaApiEvent_onGetCharacterImageResponse,
  LaylaApiEvent_onGenerateImageResponse,
  LaylaApiEvent_onGetImageGenerationModelsResponse,
  LaylaApiEvent_onUpdateCharacterResponse,
  LaylaApiEvent_onGetChatHistoryResponse,
  LaylaApiEvent_onGetChatSessionsResponse,
  LaylaApiEvent_onSaveChatMessageResponse,
  LaylaApiEvent_onScheduledChatMessage,
  LaylaApiEvent_onGetScheduledChatMessagesResponse,
  LaylaApiEvent_onCancelScheduledChatMessage,
  LaylaApiEvent_onGetSentimentResponse,
  LaylaApiEvent_onSaveFileResponse,
  LaylaApiEvent_onReadFileResponse,
  LaylaApiEvent_onGetMemoriesResponse,
  LaylaApiEvent_onGetTopMemoriesResponse,
  LaylaApiEvent_onCreateOrUpdateMemoriesResponse,
  LaylaApiEvent_onGetPersonaResponse,
  LaylaApiEvent_onGetTTSVoicesResponse,
  LaylaApiEvent_onGetInferenceEnginesResponse,
  LaylaApiEvent_onSetInferenceEngineResponse,
  LaylaApiEvent_onFinishedSpeaking,
  LaylaApiEvent_onGenerateVoiceToFileResponse,
  LaylaApiEvent_onGetExecutionContextResponse,
  LaylaApiEvent_onChatContextNewMessage,
  LaylaApiEvent_onChatContextSentimentUpdate,
  LaylaApiEvent_onChatContextStartedSpeaking,
  LaylaApiEvent_onChatContextFinishedSpeaking,
  LaylaApiEvent_onChatContextStartedThinking,
  LaylaApiEvent_onBackgroundAudioTrackChanged,
  LaylaApiEvent_onBackgroundAudioStatus,
  LaylaApiEvent_onBackgroundAudioFinished,
  LaylaApiEvent_onSTTListeningStarted,
  LaylaApiEvent_onSTTSpeechRecognized,
} from './protocol';
export { SENTIMENT_THRESHOLDS } from './protocol';

// Combined wire-contract unions (base protocol + TypeScript-side streaming events).
export type { LaylaApiRequest, LaylaApiEvent } from './interface';
export type {
  LaylaApiEvent_onMsg,
  LaylaApiEvent_onGenerateImageProgress,
} from './typescript-protocol';

// Errors.
export {
  LaylaError,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
} from './errors';

// Shared request options.
export type { RequestOptions } from './internal/one-shot';

// Chat resource surface.
export { ChatCompletionStream } from './resources/chat';
export type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from './resources/chat';

// Image resource surface.
export { Images } from './resources/images';
export type { LaylaImageGenerationModel } from './resources/images';

// Utility resource surface.
export { Utils } from './resources/utils';
export type { ReadFileResult, SaveFileResult } from './resources/utils';

// Memory resource surface.
export { Memories } from './resources/memories';
export type { MemoryListOptions } from './resources/memories';

// Persona resource surface.
export { Personas } from './resources/personas';

// Text-to-speech resource surface.
export { TTS } from './resources/tts';
export type { GenerateVoiceToFileResult } from './resources/tts';

// Speech-to-text resource surface.
export { STT } from './resources/stt';
export type {
  STTSpeechRecognized,
  STTSpeechRecognizedListener,
} from './resources/stt';

// Background audio player surface.
export { BackgroundAudio } from './resources/background-audio';
export type {
  BackgroundAudioMetadata,
  BackgroundAudioTrackChanged,
  BackgroundAudioTrackChangedListener,
  BackgroundAudioStatus,
  BackgroundAudioStatusListener,
  BackgroundAudioFinished,
  BackgroundAudioFinishedListener,
} from './resources/background-audio';

// Contextual mini-app surface.
export { Contextual } from './resources/contextual';
export type {
  ChatContextFinishedSpeaking,
  ChatContextFinishedSpeakingListener,
  ChatContextNewMessage,
  ChatContextNewMessageListener,
  ChatContextSentimentUpdate,
  ChatContextSentimentUpdateListener,
  ChatContextStartedSpeaking,
  ChatContextStartedSpeakingListener,
  ChatContextStartedThinking,
  ChatContextStartedThinkingListener,
} from './resources/contextual';

// Client.
export { LaylaSDK, Layla } from './client';
export type { LaylaSDKOptions } from './client';
export { default } from './client';

// Mock host (dev-only).
export { installLaylaMock, makeMockCharacter } from './mock';
