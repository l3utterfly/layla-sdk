/**
 * resources/chat/stream.ts
 * ------------------------
 * ChatCompletionStream: the user-facing streaming object.
 *
 * - Async-iterable of ChatCompletionChunk (the OpenAI `for await` pattern)
 * - Event emitter: 'content' | 'chunk' | 'end' | 'error'
 * - Convenience: finalContent(), finalChatCompletion()
 *
 * Implements BridgeSink so the bridge can drive it from `on_message*` events.
 */

import { LaylaAbortError } from '../../errors';
import type { LaylaApiCancel, LaylaApiEvent } from '../../protocol';
import { Deferred } from '../../internal/deferred';
import { LaylaBridge, type BridgeSink } from '../../internal/bridge';
import type { ChatCompletion, ChatCompletionChunk } from './types';

type Listener = (...args: any[]) => void;
type ChatCompletionDelta = NonNullable<
  ChatCompletionChunk['choices'][number]['delta']
>;

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

const isPotentialThinkTag = (value: string): boolean =>
  (THINK_OPEN_TAG.startsWith(value) || THINK_CLOSE_TAG.startsWith(value)) &&
  value.length < Math.max(THINK_OPEN_TAG.length, THINK_CLOSE_TAG.length);

export class ChatCompletionStream
  implements BridgeSink, AsyncIterable<ChatCompletionChunk>
{
  private readonly id = `chatcmpl-layla-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  private readonly created = Math.floor(Date.now() / 1000);
  private readonly model: string;

  private buffer: ChatCompletionChunk[] = [];
  private resolvers: Array<(r: IteratorResult<ChatCompletionChunk>) => void> = [];
  private rejectors: Array<(e: unknown) => void> = [];

  private rawSnapshot = '';
  private contentSnapshot = '';
  private reasoningSnapshot = '';
  private pendingTag = '';
  private inReasoning = false;
  private ended = false;
  private closed = false;
  private failure: Error | null = null;

  private listeners: Record<string, Listener[]> = {};
  private finalDeferred = new Deferred<ChatCompletion>();

  constructor(model: string) {
    this.model = model;
    // Don't crash with an unhandled rejection if the caller never reads the
    // final completion promise.
    this.finalDeferred.promise.catch(() => undefined);
  }

  /* ---- event emitter (mirrors OpenAI's .stream() helper) ---------------- */

  on(event: 'content', listener: (delta: string, snapshot: string) => void): this;
  on(event: 'reasoning', listener: (delta: string, snapshot: string) => void): this;
  on(event: 'chunk', listener: (chunk: ChatCompletionChunk) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: Listener): this {
    (this.listeners[event] ||= []).push(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    const ls = this.listeners[event];
    if (ls) this.listeners[event] = ls.filter((l) => l !== listener);
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    const ls = this.listeners[event];
    if (!ls) return;
    for (const l of ls.slice()) {
      try {
        l(...args);
      } catch {
        // listener errors must not break the stream
      }
    }
  }

  /* ---- BridgeSink: driven by the bridge --------------------------------- */

  accept(event: LaylaApiEvent): boolean {
    switch (event.event) {
      case 'on_message': {
        const data = event.data ?? { msg: '', delta: '' };
        this.handleDelta(data.delta ?? '', data.msg ?? '');
        return false; // not terminal
      }
      case 'on_message_end':
        this.handleEnd();
        return true; // terminal
      default:
        return false; // not ours
    }
  }

  fail(err: Error): void {
    if (this.closed) return;
    this.failure = err;
    this.closed = true;
    this.drainError(err);
    this.emit('error', err);
    this.finalDeferred.reject(err);
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage(): LaylaApiCancel {
    return { cmd: 'cancel' };
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    if (this.closed) return;
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally BEFORE telling the host to stop. The terminating
    // on_message_end the host sends back must land on an already-closed sink
    // (swallowed), never re-resolve this stream.
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }

  private handleDelta(delta: string, snapshot: string): void {
    if (this.closed) return;
    const rawDelta = this.resolveRawDelta(delta, snapshot);
    const parsed = this.parseTaggedDelta(rawDelta);
    this.contentSnapshot += parsed.content;
    this.reasoningSnapshot += parsed.reasoning;

    const chunkDelta: ChatCompletionDelta = {};
    if (parsed.content) chunkDelta.content = parsed.content;
    if (parsed.reasoning) chunkDelta.reasoning = parsed.reasoning;
    if (!chunkDelta.content && !chunkDelta.reasoning) return;

    const chunk = this.makeChunk(chunkDelta, null);
    this.pushChunk(chunk);
    this.emit('chunk', chunk);
    if (parsed.content) {
      this.emit('content', parsed.content, this.contentSnapshot);
    }
    if (parsed.reasoning) {
      this.emit('reasoning', parsed.reasoning, this.reasoningSnapshot);
    }
  }

  private handleEnd(): void {
    if (this.closed) return;
    this.flushPendingTag();
    // Final chunk with empty delta + finish_reason, matching OpenAI semantics.
    const finalChunk = this.makeChunk({}, 'stop');
    this.pushChunk(finalChunk);
    this.emit('chunk', finalChunk);

    this.ended = true;
    this.closed = true;
    this.drainDone();

    const completion = this.buildCompletion();
    this.emit('end');
    this.finalDeferred.resolve(completion);
  }

  /* ---- async iteration -------------------------------------------------- */

  next(): Promise<IteratorResult<ChatCompletionChunk>> {
    if (this.buffer.length) {
      return Promise.resolve({ value: this.buffer.shift()!, done: false });
    }
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejectors.push(reject);
    });
  }

  /** Breaking out of `for await` aborts the request, like the OpenAI SDK. */
  return(): Promise<IteratorResult<ChatCompletionChunk>> {
    this.abort(new LaylaAbortError('Stream consumer stopped'));
    return Promise.resolve({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    return this;
  }

  /* ---- convenience promises -------------------------------------------- */

  finalChatCompletion(): Promise<ChatCompletion> {
    return this.finalDeferred.promise;
  }

  async finalContent(): Promise<string> {
    const completion = await this.finalDeferred.promise;
    return completion.choices[0]?.message.content ?? '';
  }

  /* ---- internals -------------------------------------------------------- */

  private pushChunk(chunk: ChatCompletionChunk): void {
    if (this.resolvers.length) {
      this.resolvers.shift()!({ value: chunk, done: false });
      this.rejectors.shift();
    } else {
      this.buffer.push(chunk);
    }
  }

  private drainDone(): void {
    while (this.resolvers.length) {
      this.resolvers.shift()!({ value: undefined as never, done: true });
      this.rejectors.shift();
    }
  }

  private drainError(err: Error): void {
    while (this.rejectors.length) {
      this.rejectors.shift()!(err);
      this.resolvers.shift();
    }
  }

  private resolveRawDelta(delta: string, snapshot: string): string {
    if (snapshot) {
      const rawDelta = snapshot.startsWith(this.rawSnapshot)
        ? snapshot.slice(this.rawSnapshot.length)
        : delta;
      this.rawSnapshot = snapshot;
      return rawDelta || delta;
    }

    this.rawSnapshot += delta;
    return delta;
  }

  private parseTaggedDelta(delta: string): { content: string; reasoning: string } {
    let content = '';
    let reasoning = '';
    const append = (value: string) => {
      if (this.inReasoning) reasoning += value;
      else content += value;
    };

    const text = this.pendingTag + delta;
    this.pendingTag = '';

    let index = 0;
    while (index < text.length) {
      const tagStart = text.indexOf('<', index);
      if (tagStart === -1) {
        append(text.slice(index));
        break;
      }

      append(text.slice(index, tagStart));

      const remaining = text.slice(tagStart);
      if (remaining.startsWith(THINK_OPEN_TAG)) {
        this.inReasoning = true;
        index = tagStart + THINK_OPEN_TAG.length;
        continue;
      }
      if (remaining.startsWith(THINK_CLOSE_TAG)) {
        this.inReasoning = false;
        index = tagStart + THINK_CLOSE_TAG.length;
        continue;
      }
      if (isPotentialThinkTag(remaining)) {
        this.pendingTag = remaining;
        break;
      }

      append('<');
      index = tagStart + 1;
    }

    return { content, reasoning };
  }

  private flushPendingTag(): void {
    if (!this.pendingTag) return;
    const parsed = this.inReasoning
      ? { content: '', reasoning: this.pendingTag }
      : { content: this.pendingTag, reasoning: '' };
    this.pendingTag = '';
    this.contentSnapshot += parsed.content;
    this.reasoningSnapshot += parsed.reasoning;

    if (!parsed.content && !parsed.reasoning) return;
    const chunk = this.makeChunk(parsed, null);
    this.pushChunk(chunk);
    this.emit('chunk', chunk);
    if (parsed.content) this.emit('content', parsed.content, this.contentSnapshot);
    if (parsed.reasoning) {
      this.emit('reasoning', parsed.reasoning, this.reasoningSnapshot);
    }
  }

  private makeChunk(
    delta: ChatCompletionDelta,
    finish: 'stop' | null,
  ): ChatCompletionChunk {
    return {
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
  }

  private buildCompletion(): ChatCompletion {
    const message: ChatCompletion['choices'][number]['message'] = {
      role: 'assistant',
      content: this.contentSnapshot,
    };
    if (this.reasoningSnapshot) message.reasoning = this.reasoningSnapshot;

    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: 'stop',
        },
      ],
    };
  }
}
