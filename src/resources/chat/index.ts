/**
 * resources/chat/index.ts
 * -----------------------
 * The chat resource: completions, session/history reads, and message saves.
 * Completions mirror the OpenAI SDK shape. Re-exports the public chat types
 * and the stream class for the package barrel.
 */

import { LaylaAbortError } from '../../errors';
import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetChatHistoryResponse,
  LaylaApiEvent_onGetChatSessionsResponse,
  LaylaApiEvent_onSaveChatMessageResponse,
  LaylaChatHistoryEntry,
  LaylaChatMessage,
} from '../../protocol';
import { LaylaBridge } from '../../internal/bridge';
import { ChatCompletionStream } from './stream';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './types';
import { oneShot, RequestOptions } from '../../internal/one-shot';

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
    messages: LaylaChatMessage[],
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
      message: { cmd: 'send_message', data: messages },
      sink: stream,
    });
    return stream;
  }
}

export class Chat {
  readonly completions = new Completions();

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
}

export { ChatCompletionStream } from './stream';
export type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './types';
