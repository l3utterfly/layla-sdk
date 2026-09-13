/**
 * resources/chat/index.ts
 * -----------------------
 * The chat resource: completions, session/history reads, and message saves.
 * Completions mirror the OpenAI SDK shape. Re-exports the public chat types
 * and the stream class for the package barrel.
 */

import { LaylaAbortError } from '../../errors';
import type { LaylaApiEvent } from '../../interface';
import type {
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
  LaylaChatRole,
  LaylaScheduledChatMessage,
} from '../../protocol';
import { LaylaBridge } from '../../internal/bridge';
import { hostSupportsSendMessageV2 } from '../../internal/host-version';
import { ChatCompletionStream } from './stream';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from './types';
import { oneShot, type RequestOptions } from '../../internal/one-shot';

const BASE64_IMAGE_DATA_URL =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,/i;

/**
 * On the `send_message` path the SDK forwards only the part of the OpenAI
 * request surface that Layla's protocol can carry. Anything it cannot carry is
 * dropped rather than rejected, but never silently: dropping a message or an
 * image the caller supplied is invisible otherwise. Hosts on the
 * `send_message_v2` path read the request untranslated and drop nothing, so
 * none of this runs for them.
 */
function warnIgnored(what: string, reason: string): void {
  console.warn(`[layla-sdk] ${what} ${reason}.`);
}

/**
 * Translate OpenAI-shaped messages into the host's `send_message` payload.
 *
 * `tool` and `function` messages are dropped (Layla has no tool loop), so this
 * can return fewer messages than it was given.
 */
function toLaylaChatMessages(
  messages: ChatCompletionMessageParam[],
): LaylaChatMessage[] {
  const translated: LaylaChatMessage[] = [];
  for (const message of messages) {
    const laylaMessage = toLaylaChatMessage(message);
    if (laylaMessage) translated.push(laylaMessage);
  }
  return translated;
}

function toLaylaChatMessage(
  message: ChatCompletionMessageParam,
): LaylaChatMessage | null {
  if (message.role === 'tool' || message.role === 'function') {
    warnIgnored(
      `\`${message.role}\` message`,
      'was dropped: Layla has no tool loop',
    );
    return null;
  }

  // `developer` is OpenAI's rename of `system`; the host only knows `system`.
  const role: LaylaChatRole =
    message.role === 'developer' ? 'system' : message.role;

  // OpenAI types assistant content as optional; the Layla protocol always
  // carries the field, with `null` standing in for "no content".
  const content = message.content ?? null;

  if (!Array.isArray(content)) {
    return { role, content, name: message.name };
  }

  const textParts: string[] = [];
  let imageUrl: string | undefined;

  for (const part of content) {
    switch (part.type) {
      case 'text':
        textParts.push(part.text);
        break;
      case 'image_url': {
        const url = part.image_url.url;
        if (!BASE64_IMAGE_DATA_URL.test(url)) {
          // The protocol field is `image_base64`; a remote URL has nothing to
          // translate to, and the host cannot fetch it.
          warnIgnored(
            'Remote image_url',
            'was ignored: Layla image inputs must be a base64 data URL for a PNG, JPEG, GIF, or WEBP image',
          );
          break;
        }
        if (imageUrl) {
          warnIgnored(
            'Extra image_url part',
            'was ignored: Layla supports at most one image per chat message',
          );
          break;
        }
        imageUrl = url;
        break;
      }
      default:
        // `input_audio`, `file`, and assistant `refusal` parts.
        warnIgnored(
          `\`${part.type}\` content part`,
          'was ignored: it has no representation in the Layla protocol',
        );
        break;
    }
  }

  return {
    role,
    content: textParts.length > 0 ? textParts.join('\n') : null,
    name: message.name,
    ...(imageUrl ? { image_base64: imageUrl } : {}),
  };
}

/**
 * Serialise the caller's request for `send_message_v2`, which carries the raw
 * OpenAI body for the host to interpret itself.
 *
 * Nothing is translated. Two SDK-level fields are handled: `signal` is a Layla
 * extension (and not serialisable), and `stream` is pinned on, because the
 * host answers every generation over the streaming `on_message`/
 * `on_message_end` pair regardless of how the caller consumes it.
 */
function toSendMessageV2Body(body: ChatCompletionCreateParamsBase): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signal, ...request } = body;
  return JSON.stringify({ ...request, stream: true });
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
    const stream = this.startStream(body);
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
    return this.startStream(body);
  }

  private startStream(
    body: ChatCompletionCreateParamsBase,
  ): ChatCompletionStream {
    const stream = new ChatCompletionStream(body.model ?? 'layla');
    const signal = body.signal;

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

    // Which command carries the request depends on the host's version, which
    // is only knowable asynchronously — so the job is enqueued from a `then`
    // while the public API stays synchronous. Nothing else changes: the answer
    // is memoised after the first completion, concurrent callers resolve in
    // the order they asked (so generations still reach the lane in call
    // order), and a stream aborted before it is enqueued is simply dropped,
    // exactly as one aborted while queued would be.
    void hostSupportsSendMessageV2().then((useSendMessageV2) => {
      if (stream.isClosed()) return;
      LaylaBridge.shared().enqueue({
        message: useSendMessageV2
          ? { cmd: 'send_message_v2', data: toSendMessageV2Body(body) }
          : { cmd: 'send_message', data: toLaylaChatMessages(body.messages) },
        sink: stream,
        // All chat generations share the `on_message*` event shape, so they
        // serialise within a single lane; other surfaces run alongside them.
        laneKey: 'on_message_end',
      });
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
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
  ChatCompletionChunkDelta,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from './types';
