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
  LaylaCharacter,
  TavernCardV2,
  TavernCharacterBook,
  LaylaApiSendMessage,
  LaylaApiGetCharacters,
  LaylaApiGetCharacterImage,
  LaylaApiGenerateImage,
  LaylaApiCancel,
  LaylaApiRequest,
  LaylaApiEvent,
  LaylaApiEvent_onMsg,
  LaylaApiEvent_onMsgEnd,
  LaylaApiEvent_onError,
  LaylaApiEvent_onGetCharactersResponse,
  LaylaApiEvent_onGetCharacterImageResponse,
  LaylaApiEvent_onGenerateImageResponse,
} from './protocol';

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

// Client.
export { LaylaSDK, Layla } from './client';
export type { LaylaSDKOptions } from './client';
export { default } from './client';
