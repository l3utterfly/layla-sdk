/**
 * resources/chat/index.ts
 * -----------------------
 * The chat resource: `layla.chat.completions.create(...)` / `.stream(...)`,
 * mirroring the OpenAI SDK shape. Re-exports the public chat types and the
 * stream class for the package barrel.
 */

import { LaylaAbortError } from '../../errors';
import type { LaylaChatMessage } from '../../protocol';
import { LaylaBridge } from '../../internal/bridge';
import { ChatCompletionStream } from './stream';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './types';

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
}

export { ChatCompletionStream } from './stream';
export type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './types';
