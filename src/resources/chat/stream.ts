/**
 * resources/chat/stream.ts
 * ------------------------
 * ChatCompletionStream: the user-facing streaming object.
 *
 * - Async-iterable of ChatCompletionChunk (the OpenAI `for await` pattern)
 * - Event emitter: 'content' | 'reasoning' | 'toolCall' | 'chunk' | 'end' | 'error'
 * - Convenience: finalContent(), finalChatCompletion()
 *
 * The host streams one string, with everything that is not prose carried as
 * markup inside it: `<think>` for reasoning, `<tool_call>` for the calls a
 * reply asks for. Both are lifted back out here, so a consumer sees the OpenAI
 * fields (`delta.reasoning`, `delta.tool_calls`) and never the markup.
 *
 * Implements BridgeSink so the bridge can drive it from `on_message*` events.
 */

import { LaylaAbortError } from '../../errors';
import type { LaylaApiEvent } from '../../interface';
import type { LaylaApiCancel } from '../../protocol';
import { Deferred } from '../../internal/deferred';
import { LaylaBridge, type BridgeSink } from '../../internal/bridge';
import { parseToolCallBlock } from './tool-calls';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionFinishReason,
  ChatCompletionMessageToolCall,
  ChatCompletionToolCallDelta,
} from './types';

type Listener = (...args: any[]) => void;
type ChatCompletionDelta = NonNullable<
  ChatCompletionChunk['choices'][number]['delta']
>;

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';
const TOOL_CALL_OPEN_TAG = '<tool_call>';
const TOOL_CALL_CLOSE_TAG = '</tool_call>';

/**
 * True when `value` could still grow into one of `tags` — a tag split across
 * two deltas, which has to be held back rather than emitted as text.
 */
const isPotentialTag = (value: string, ...tags: string[]): boolean =>
  tags.some((tag) => tag.startsWith(value) && value.length < tag.length);

/** What one delta of host text carried, once the markup is taken off it. */
interface ParsedDelta {
  content: string;
  reasoning: string;
  toolCalls: ChatCompletionToolCallDelta[];
}

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
  /** Inside a `<tool_call>` block: text goes to the buffer, not to content. */
  private inToolCall = false;
  private toolCallBuffer = '';
  /** Every call read so far, in the order the reply asked for them. */
  private toolCallsSnapshot: ChatCompletionMessageToolCall[] = [];
  /**
   * Whitespace seen since the last `</tool_call>`, held rather than emitted.
   *
   * The host writes a newline between two finished calls, and that separator
   * is markup — but prose resuming after a call keeps its own leading space.
   * The two only tell apart once the next non-whitespace arrives, so the gap
   * waits here: discarded if another call opens, emitted if anything else does.
   */
  private spaceAfterToolCall: string | null = null;
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
  on(
    event: 'toolCall',
    listener: (toolCall: ChatCompletionMessageToolCall) => void,
  ): this;
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
    this.emitParsed(this.parseTaggedDelta(rawDelta));
  }

  private handleEnd(): void {
    if (this.closed) return;
    // Nothing more is coming, so a half-read tag is text and a `<tool_call>`
    // the host never closed is as complete as that call will ever be.
    this.emitParsed(this.parseTaggedDelta('', true));
    // Final chunk with empty delta + finish_reason, matching OpenAI semantics.
    const finalChunk = this.makeChunk({}, this.finishReason());
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

  /**
   * Take one delta of host text apart into the OpenAI fields it carries.
   *
   * `final` is set once the stream has ended: a partial tag can no longer grow
   * into a real one, so it is emitted as the text it is, and a `<tool_call>`
   * block still open is closed with whatever it managed to carry.
   */
  private parseTaggedDelta(delta: string, final = false): ParsedDelta {
    let content = '';
    let reasoning = '';
    const toolCalls: ChatCompletionToolCallDelta[] = [];

    const append = (value: string) => {
      if (!value) return;
      if (this.inToolCall) {
        this.toolCallBuffer += value;
        return;
      }
      if (this.inReasoning) {
        reasoning += value;
        return;
      }
      if (this.spaceAfterToolCall !== null) {
        if (!/\S/.test(value)) {
          this.spaceAfterToolCall += value;
          return;
        }
        content += this.spaceAfterToolCall;
        this.spaceAfterToolCall = null;
      }
      content += value;
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

      // Inside a call, only its closing tag means anything: the rest is JSON,
      // and JSON may hold a `<` of its own inside a string argument.
      if (this.inToolCall) {
        if (remaining.startsWith(TOOL_CALL_CLOSE_TAG)) {
          const call = this.closeToolCall();
          if (call) toolCalls.push(call);
          index = tagStart + TOOL_CALL_CLOSE_TAG.length;
          continue;
        }
        if (!final && isPotentialTag(remaining, TOOL_CALL_CLOSE_TAG)) {
          this.pendingTag = remaining;
          break;
        }
        append('<');
        index = tagStart + 1;
        continue;
      }

      if (remaining.startsWith(TOOL_CALL_OPEN_TAG)) {
        // The gap before this call was the host's separator after the last
        // one, not part of the reply.
        this.spaceAfterToolCall = null;
        this.inToolCall = true;
        this.toolCallBuffer = '';
        index = tagStart + TOOL_CALL_OPEN_TAG.length;
        continue;
      }
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
      if (
        !final &&
        isPotentialTag(
          remaining,
          THINK_OPEN_TAG,
          THINK_CLOSE_TAG,
          TOOL_CALL_OPEN_TAG,
        )
      ) {
        this.pendingTag = remaining;
        break;
      }

      append('<');
      index = tagStart + 1;
    }

    if (final) {
      if (this.inToolCall) {
        const call = this.closeToolCall();
        if (call) toolCalls.push(call);
      }
      // Nothing follows to say what the held gap was, so keep it: the reply's
      // own trailing whitespace is the likelier reading, and it is harmless.
      if (this.spaceAfterToolCall) {
        content += this.spaceAfterToolCall;
        this.spaceAfterToolCall = null;
      }
    }

    return { content, reasoning, toolCalls };
  }

  /**
   * End the `<tool_call>` block being read and record the call it named.
   * Returns the streaming delta for it, or `null` for a block that named no
   * tool — a generation cut off before the name closed, which is nothing a
   * caller could act on.
   */
  private closeToolCall(): ChatCompletionToolCallDelta | null {
    const block = this.toolCallBuffer;
    this.toolCallBuffer = '';
    this.inToolCall = false;
    this.spaceAfterToolCall = '';

    const parsed = parseToolCallBlock(block);
    if (!parsed) {
      console.warn(
        '[layla-sdk] A <tool_call> block was dropped: it names no tool.',
      );
      return null;
    }

    const index = this.toolCallsSnapshot.length;
    const call: ChatCompletionMessageToolCall = {
      id: parsed.id,
      type: 'function',
      function: { name: parsed.name, arguments: parsed.arguments },
    };
    this.toolCallsSnapshot.push(call);

    // A call is emitted whole, once. The host writes the `tool_call_id` last,
    // so nothing before `</tool_call>` is a call a consumer could run yet.
    return { index, ...call };
  }

  /** Push whatever a parsed delta carried to the chunk stream and listeners. */
  private emitParsed(parsed: ParsedDelta): void {
    this.contentSnapshot += parsed.content;
    this.reasoningSnapshot += parsed.reasoning;

    const chunkDelta: ChatCompletionDelta = {};
    if (parsed.content) chunkDelta.content = parsed.content;
    if (parsed.reasoning) chunkDelta.reasoning = parsed.reasoning;
    if (parsed.toolCalls.length > 0) chunkDelta.tool_calls = parsed.toolCalls;
    if (
      !chunkDelta.content &&
      !chunkDelta.reasoning &&
      !chunkDelta.tool_calls
    ) {
      return;
    }

    const chunk = this.makeChunk(chunkDelta, null);
    this.pushChunk(chunk);
    this.emit('chunk', chunk);
    if (parsed.content) {
      this.emit('content', parsed.content, this.contentSnapshot);
    }
    if (parsed.reasoning) {
      this.emit('reasoning', parsed.reasoning, this.reasoningSnapshot);
    }
    for (const call of parsed.toolCalls) {
      this.emit('toolCall', this.toolCallsSnapshot[call.index]);
    }
  }

  /**
   * A reply that asked for tools stopped to call them, which OpenAI reports as
   * `tool_calls` rather than `stop`.
   */
  private finishReason(): ChatCompletionFinishReason {
    return this.toolCallsSnapshot.length > 0 ? 'tool_calls' : 'stop';
  }

  private makeChunk(
    delta: ChatCompletionDelta,
    finish: ChatCompletionFinishReason | null,
  ): ChatCompletionChunk {
    return {
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
    };
  }

  private buildCompletion(): ChatCompletion {
    const message: ChatCompletion['choices'][number]['message'] = {
      role: 'assistant',
      content: this.contentSnapshot,
      // Required by the OpenAI ChatCompletionMessage shape. Layla has no
      // refusal channel, so it is always null.
      refusal: null,
    };
    if (this.reasoningSnapshot) message.reasoning = this.reasoningSnapshot;
    if (this.toolCallsSnapshot.length > 0) {
      message.tool_calls = this.toolCallsSnapshot;
    }

    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: this.finishReason(),
          // Required by the OpenAI ChatCompletion.Choice shape; Layla does not
          // expose token log probabilities.
          logprobs: null,
        },
      ],
    };
  }
}
