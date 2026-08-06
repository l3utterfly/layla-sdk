/**
 * resources/chat/index.ts
 * -----------------------
 * The chat resource: completions, session/history reads, and message saves.
 * Completions mirror the OpenAI SDK shape. Re-exports the public chat types
 * and the stream class for the package barrel.
 */

import { LaylaAbortError, LaylaError } from '../../errors';
import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetChatHistoryResponse,
  LaylaApiEvent_onGetInferenceEnginesResponse,
  LaylaApiEvent_onGetChatSessionsResponse,
  LaylaApiEvent_onGetScheduledChatMessagesResponse,
  LaylaApiEvent_onSaveChatMessageResponse,
  LaylaApiEvent_onCancelScheduledChatMessage,
  LaylaApiEvent_onScheduledChatMessage,
  LaylaApiEvent_onSetInferenceEngineResponse,
  LaylaChatHistoryEntry,
  LaylaChatMessage,
  LaylaScheduledChatMessage,
} from '../../protocol';
import { LaylaBridge } from '../../internal/bridge';
import { ChatCompletionStream } from './stream';
import type {
  ChatCompletion,
  ChatCompletionContentPartImage,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from './types';
import { oneShot, type RequestOptions } from '../../internal/one-shot';

const BASE64_IMAGE_DATA_URL =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,/i;

function toLaylaChatMessage(
  message: ChatCompletionMessageParam,
): LaylaChatMessage {
  if (!Array.isArray(message.content)) {
    return {
      role: message.role,
      content: message.content,
      name: message.name,
    };
  }

  const textParts = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text);
  const images = message.content.filter(
    (part): part is ChatCompletionContentPartImage =>
      part.type === 'image_url',
  );

  if (images.length > 1) {
    throw new LaylaError(
      'Layla supports at most one image_url content part per chat message.',
    );
  }

  const imageUrl = images[0]?.image_url.url;
  if (imageUrl && !BASE64_IMAGE_DATA_URL.test(imageUrl)) {
    throw new LaylaError(
      'Layla image inputs must use a base64 data URL for a PNG, JPEG, GIF, or WEBP image. Remote image URLs cannot be translated to the Layla image_base64 protocol field.',
    );
  }

  return {
    role: message.role,
    content: textParts.length > 0 ? textParts.join('\n') : null,
    name: message.name,
    ...(imageUrl ? { image_base64: imageUrl } : {}),
  };
}

class Completions {
  create(
    body: ChatCompletionCreateParamsNonStreaming,
  ): Promise<ChatCompletion>;
  create(
    body: ChatCompletionCreateParamsStreaming,
  ): Promise<ChatCompletionStream>;
  create(
    body: ChatCompletionCreateParamsBase,
  ): Promise<ChatCompletion | ChatCompletionStream> {
    const stream = this.startStream(
      body.messages,
      body.model ?? 'layla',
      body.signal,
    );
    if (body.stream) return Promise.resolve(stream);
    return stream.finalChatCompletion();
  }

  /**
   * OpenAI-style helper: returns the live stream object synchronously (not a
   * promise), so you can attach `.on(...)` listeners before any token arrives.
   */
  stream(
    body: Omit<ChatCompletionCreateParamsBase, 'stream'>,
  ): ChatCompletionStream {
    return this.startStream(body.messages, body.model ?? 'layla', body.signal);
  }

  private startStream(
    messages: ChatCompletionMessageParam[],
    model: string,
    signal?: AbortSignal,
  ): ChatCompletionStream {
    const stream = new ChatCompletionStream(model);

    if (signal?.aborted) {
      // Never enqueue an already-aborted request.
      queueMicrotask(() => stream.abort(new LaylaAbortError()));
      return stream;
    }
    if (signal) {
      signal.addEventListener(
        'abort',
        () => stream.abort(new LaylaAbortError()),
        { once: true },
      );
    }

    LaylaBridge.shared().enqueue({
      message: {
        cmd: 'send_message',
        data: messages.map(toLaylaChatMessage),
      },
      sink: stream,
    });
    return stream;
  }
}

export class Chat {
  readonly completions = new Completions();

  /**
   * Fetch the inference engines available for subsequent chat completions.
   */
  getInferenceEngines(options: RequestOptions = {}): Promise<string[]> {
    return oneShot<string[]>(
      { cmd: 'get_inference_engines', data: null },
      'on_get_inference_engines_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetInferenceEnginesResponse).data.engines,
      options.signal,
    );
  }

  /**
   * Select the inference engine used for subsequent chat completions.
   * Pass `null` to reset to the host's default engine.
   */
  setInferenceEngine(
    engineName: string | null,
    options: RequestOptions = {},
  ): Promise<LaylaApiEvent_onSetInferenceEngineResponse['data']> {
    return oneShot<LaylaApiEvent_onSetInferenceEngineResponse['data']>(
      { cmd: 'set_inference_engine', data: { engineName } },
      'on_set_inference_engine_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onSetInferenceEngineResponse).data,
      options.signal,
    );
  }

  /**
   * Ask the native host for a character's chat history. Resolves once with the host's `on_get_chat_history_response` payload, or rejects on error/abort.
   * Results are in reverse chronological order (newest first). Use `offset` and `range` to page through the history if needed.
   * @param sessionId The ID of the session whose chat history is being requested.
   * @param offset The starting point for the chat history results.
   * @param range The number of chat history entries to retrieve.
   * @param options Additional request options.
   * @returns A promise that resolves to an array of chat history entries.
   */
  getChatHistory(sessionId: string, offset: number = 0, range: number = 10, options: RequestOptions = {}): Promise<LaylaChatHistoryEntry[]> {
    return oneShot<LaylaChatHistoryEntry[]>(
      { cmd: 'get_chat_history', data: { session_id: sessionId, offset, limit: range } },
      'on_get_chat_history_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetChatHistoryResponse).data;
        return data?.messages ?? [];
      },
      options.signal,
    );
  }

  /**
   * Ask the native host for a character's chat sessions. Resolves once with the host's `on_get_chat_sessions_response` payload, or rejects on error/abort.
   * Results are in reverse chronological order (newest first). Use `offset` and `range` to page through the sessions if needed.
   * @param characterId The ID of the character whose chat sessions are being requested.
   * @param offset The starting point for the chat sessions results.
   * @param range The number of chat sessions to retrieve.
   * @param options Additional request options.
   * @returns A promise that resolves to an object containing the chat sessions.
   */
  getChatSessions(characterId: string, offset: number = 0, range: number = 10, options: RequestOptions = {}): Promise<LaylaApiEvent_onGetChatSessionsResponse['data']> {
    return oneShot<LaylaApiEvent_onGetChatSessionsResponse['data']>(
      { cmd: 'get_chat_sessions', data: { character_id: characterId, offset, limit: range } },
      'on_get_chat_sessions_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetChatSessionsResponse).data;
        return data;
      },
      options.signal,
    );
  }

  /**
   * Create or update a chat history entry. Pass an id less than or equal to
   * zero to create a message, or an existing positive id to update it.
   * @param message The complete chat history entry to save.
   * @param options Additional request options.
   * @returns A promise that resolves to the saved entry, including its assigned id.
   */
  saveChatMessage(
    message: LaylaChatHistoryEntry,
    options: RequestOptions = {},
  ): Promise<LaylaChatHistoryEntry> {
    return oneShot<LaylaChatHistoryEntry>(
      { cmd: 'save_chat_message', data: message },
      'on_save_chat_message_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onSaveChatMessageResponse).data,
      options.signal,
    );
  }

  /**
   * Schedule a chat message to be sent by the host at a future timestamp.
   * Pass `id <= 0` when creating a new scheduled message; the host returns the
   * saved message with its assigned id.
   */
  scheduleChatMessage(
    message: LaylaScheduledChatMessage,
    options: RequestOptions = {},
  ): Promise<LaylaScheduledChatMessage> {
    return oneShot<LaylaScheduledChatMessage>(
      { cmd: 'scheduled_chat_message', data: message },
      'on_scheduled_chat_message',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onScheduledChatMessage).data,
      options.signal,
    );
  }

  /**
   * Fetch all scheduled chat messages known to the host.
   *
   * The host API is intentionally unpaged; callers should filter locally when
   * they only need scheduled messages for one character or session.
   */
  getScheduledChatMessages(
    options: RequestOptions = {},
  ): Promise<LaylaScheduledChatMessage[]> {
    return oneShot<LaylaScheduledChatMessage[]>(
      { cmd: 'get_scheduled_chat_messages', data: null },
      'on_get_scheduled_chat_messages_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetScheduledChatMessagesResponse).data
          .scheduled_messages ?? [],
      options.signal,
    );
  }

  /**
   * Cancel a scheduled chat message by id.
   */
  cancelScheduledChatMessage(
    id: number,
    options: RequestOptions = {},
  ): Promise<LaylaApiEvent_onCancelScheduledChatMessage['data']> {
    return oneShot<LaylaApiEvent_onCancelScheduledChatMessage['data']>(
      { cmd: 'cancel_scheduled_chat_message', data: { id } },
      'on_cancel_scheduled_chat_message',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onCancelScheduledChatMessage).data,
      options.signal,
    );
  }
}

export { ChatCompletionStream } from './stream';
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
} from './types';
