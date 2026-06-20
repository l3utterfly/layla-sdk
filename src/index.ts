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
  LaylaCharacter,
  TavernCardV2,
  TavernCharacterBook,
  SentimentValues,

  // command types
  LaylaApiSendMessage,
  LaylaApiGetCharacters,
  LaylaApiGetCharacterImage,
  LaylaApiGenerateImage,
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
  LaylaApiCancel,
  LaylaApiRequest,

  // event types
  LaylaApiEvent,
  LaylaApiEvent_onMsg,
  LaylaApiEvent_onMsgEnd,
  LaylaApiEvent_onError,
  LaylaApiEvent_onGetCharactersResponse,
  LaylaApiEvent_onGetCharacterImageResponse,
  LaylaApiEvent_onGenerateImageResponse,
  LaylaApiEvent_onGenerateImageProgress,
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
} from './protocol';
export { SENTIMENT_THRESHOLDS } from './protocol';

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
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './resources/chat';

// Image resource surface.
export { Images } from './resources/images';

// Utility resource surface.
export { Utils } from './resources/utils';
export type { ReadFileResult, SaveFileResult } from './resources/utils';

// Memory resource surface.
export { Memories } from './resources/memories';
export type { MemoryListOptions } from './resources/memories';

// Client.
export { LaylaSDK, Layla } from './client';
export type { LaylaSDKOptions } from './client';
export { default } from './client';

// Mock host (dev-only).
export { installLaylaMock, makeMockCharacter } from './mock';
