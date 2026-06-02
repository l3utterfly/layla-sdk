/**
 * LaylaSDK
 * --------
 * A web-side client (runs INSIDE the Layla WebView) that talks to the native
 * Layla app over the React Native WebView bridge, exposed through an API that
 * mirrors the OpenAI JavaScript SDK so existing OpenAI code ports with minimal
 * friction.
 *
 * The native host runs the model and streams tokens back; this SDK turns that
 * event stream into the OpenAI shapes (`ChatCompletion`, `ChatCompletionChunk`)
 * and an async-iterable stream.
 *
 * Wire protocol (must match the React Native host):
 *   Web -> RN : { cmd: 'send_message', data: LaylaChatMessage[] }
 *   RN -> Web : { event: 'on_message',     data: { msg, delta } }   (per token)
 *               { event: 'on_message_end' }                          (end)
 *               { event: 'on_error',       data: { message } }       (error)
 *
 * Quick start:
 *
 *   import { LaylaSDK } from './layla-sdk';
 *   const layla = new LaylaSDK();
 *
 *   // Streaming (async iteration) -- the OpenAI way:
 *   const stream = await layla.chat.completions.create({
 *     messages: [{ role: 'user', content: 'Hello' }],
 *     stream: true,
 *   });
 *   for await (const chunk of stream) {
 *     process_token(chunk.choices[0]?.delta?.content ?? '');
 *   }
 *
 *   // Streaming (event helper) -- maps cleanly onto Layla's delta/snapshot:
 *   const s = layla.chat.completions.stream({
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 *   s.on('content', (delta, snapshot) => render(snapshot));
 *   const final = await s.finalContent();
 *
 *   // Non-streaming -- resolves once when the model is done:
 *   const completion = await layla.chat.completions.create({
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 *   console.log(completion.choices[0].message.content);
 */

/* ============================================================================
 * Wire protocol types (keep in sync with the React Native host)
 * ========================================================================== */

export type LaylaChatRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'function';

/** An OpenAI-style chat message. */
export interface LaylaChatMessage {
  role: LaylaChatRole;
  content: string | null;
  name?: string;
}

/** Web -> RN command. */
export interface LaylaApiMessage {
  cmd: 'send_message';
  data: LaylaChatMessage[];
}

/** RN -> Web: a streamed token. `msg` is the full snapshot, `delta` is new. */
export interface LaylaApiEvent_onMsg {
  event: 'on_message';
  data: { msg: string; delta: string };
}

/** RN -> Web: stream finished. */
export interface LaylaApiEvent_onMsgEnd {
  event: 'on_message_end';
}

/** RN -> Web: error. */
export interface LaylaApiEvent_onError {
  event: 'on_error';
  data: { message: string };
}

export type LaylaApiEvent =
  | LaylaApiEvent_onMsg
  | LaylaApiEvent_onMsgEnd
  | LaylaApiEvent_onError;

/* ============================================================================
 * OpenAI-shaped output types
 * ========================================================================== */

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: 'stop' | null;
  }>;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }>;
}

export interface ChatCompletionCreateParamsBase {
  messages: LaylaChatMessage[];
  /**
   * Accepted for OpenAI compatibility. The Layla host currently picks the
   * model itself, so this is only used to populate the `model` field on the
   * returned objects unless you extend the `send_message` protocol.
   */
  model?: string;
  stream?: boolean;
  /** Abort the request from the consumer side. */
  signal?: AbortSignal;
}

export interface ChatCompletionCreateParamsNonStreaming
  extends ChatCompletionCreateParamsBase {
  stream?: false;
}

export interface ChatCompletionCreateParamsStreaming
  extends ChatCompletionCreateParamsBase {
  stream: true;
}

/* ============================================================================
 * Errors
 * ========================================================================== */

export class LaylaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaylaError';
  }
}

export class LaylaAbortError extends LaylaError {
  constructor(message = 'Request was aborted') {
    super(message);
    this.name = 'LaylaAbortError';
  }
}

export class LaylaBridgeUnavailableError extends LaylaError {
  constructor() {
    super(
      'Layla bridge unavailable: window.ReactNativeWebView is not present. ' +
        'Make sure this code runs inside the Layla WebView and that the ' +
        '<WebView> has its `onMessage` prop set (that is what injects the bridge).',
    );
    this.name = 'LaylaBridgeUnavailableError';
  }
}

/* ============================================================================
 * Internal: deferred promise
 * ========================================================================== */

class Deferred<T> {
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;
  readonly promise: Promise<T>;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}

/* ============================================================================
 * Bridge: the single low-level transport over the WebView message channel.
 *
 * Owns one global `message` listener and serialises requests, because the
 * current protocol has no request id to correlate concurrent streams. If you
 * add an `id` field to both `LaylaApiMessage` and `LaylaApiEvent`, this is the
 * one place that would change to support true concurrency.
 * ========================================================================== */

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/** Implemented by ChatCompletionStream; the bridge drives it. */
interface StreamSink {
  handleDelta(delta: string, snapshot: string): void;
  handleEnd(): void;
  handleError(err: Error): void;
  isClosed(): boolean;
}

interface BridgeJob {
  message: LaylaApiMessage;
  sink: StreamSink;
}

class LaylaBridge {
  private static instance: LaylaBridge | null = null;

  static shared(): LaylaBridge {
    if (!LaylaBridge.instance) LaylaBridge.instance = new LaylaBridge();
    return LaylaBridge.instance;
  }

  private queue: BridgeJob[] = [];
  private active: BridgeJob | null = null;
  private listening = false;

  private ensureListening(): void {
    if (this.listening || typeof window === 'undefined') return;
    window.addEventListener('message', this.onWindowMessage);
    this.listening = true;
  }

  private onWindowMessage = (event: MessageEvent): void => {
    // The RN->web bridge dispatches a MessageEvent whose `data` is the JSON
    // string of a LaylaApiEvent. Other things on the page also fire 'message'
    // (iframes, other scripts), so parse defensively and ignore anything that
    // is not one of our events.
    const raw = event.data;
    if (typeof raw !== 'string') return;

    let parsed: Partial<LaylaApiEvent>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.event !== 'string') return;

    const job = this.active;
    if (!job) return; // stray event with nothing in flight
    const sink = job.sink;

    switch (parsed.event) {
      case 'on_message': {
        const data = (parsed as LaylaApiEvent_onMsg).data ?? { msg: '', delta: '' };
        sink.handleDelta(data.delta ?? '', data.msg ?? '');
        break;
      }
      case 'on_message_end': {
        sink.handleEnd();
        this.finishActive();
        break;
      }
      case 'on_error': {
        const data = (parsed as LaylaApiEvent_onError).data;
        sink.handleError(new LaylaError(data?.message || 'Layla model error'));
        this.finishActive();
        break;
      }
      default:
        break;
    }
  };

  enqueue(message: LaylaApiMessage, sink: StreamSink): void {
    this.ensureListening();
    this.queue.push({ message, sink });
    this.pump();
  }

  /** Remove a not-yet-started job (used when a queued request is aborted). */
  cancelQueued(sink: StreamSink): void {
    this.queue = this.queue.filter((job) => job.sink !== sink);
    // If `sink` is the active job we cannot stop the host; the sink swallows
    // remaining tokens and the slot frees naturally on on_message_end.
  }

  private finishActive(): void {
    this.active = null;
    this.pump();
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.sink.isClosed()) {
      // Aborted before its turn came up.
      this.pump();
      return;
    }
    this.active = next;
    this.send(next);
  }

  private send(job: BridgeJob): void {
    if (typeof window === 'undefined' || !window.ReactNativeWebView) {
      this.active = null;
      job.sink.handleError(new LaylaBridgeUnavailableError());
      this.pump();
      return;
    }
    window.ReactNativeWebView.postMessage(JSON.stringify(job.message));
  }
}

/* ============================================================================
 * ChatCompletionStream: user-facing stream object.
 *
 * - Async-iterable of ChatCompletionChunk (the OpenAI `for await` pattern)
 * - Event emitter: 'content' | 'chunk' | 'end' | 'error'
 * - Convenience: finalContent(), finalChatCompletion()
 * ========================================================================== */

type Listener = (...args: any[]) => void;

export class ChatCompletionStream
  implements StreamSink, AsyncIterable<ChatCompletionChunk>
{
  private readonly id = `chatcmpl-layla-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  private readonly created = Math.floor(Date.now() / 1000);
  private readonly model: string;

  private buffer: ChatCompletionChunk[] = [];
  private resolvers: Array<(r: IteratorResult<ChatCompletionChunk>) => void> = [];
  private rejectors: Array<(e: unknown) => void> = [];

  private snapshot = '';
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

  /* ---- StreamSink: driven by the bridge --------------------------------- */

  handleDelta(delta: string, snapshot: string): void {
    if (this.closed) return;
    this.snapshot = snapshot || this.snapshot + delta;
    const chunk = this.makeChunk({ content: delta }, null);
    this.pushChunk(chunk);
    this.emit('chunk', chunk);
    if (delta) this.emit('content', delta, this.snapshot);
  }

  handleEnd(): void {
    if (this.closed) return;
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

  handleError(err: Error): void {
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

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    if (this.closed) return;
    const err =
      reason instanceof Error ? reason : new LaylaAbortError();
    LaylaBridge.shared().cancelQueued(this);
    this.handleError(err);
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

  private makeChunk(
    delta: { role?: 'assistant'; content?: string },
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
    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: this.snapshot },
          finish_reason: 'stop',
        },
      ],
    };
  }
}

/* ============================================================================
 * Client surface: layla.chat.completions.create(...)
 * ========================================================================== */

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

    LaylaBridge.shared().enqueue({ cmd: 'send_message', data: messages }, stream);
    return stream;
  }
}

class Chat {
  readonly completions = new Completions();
}

export interface LaylaSDKOptions {
  /** Reserved for future use (e.g. default model). */
  model?: string;
}

export class LaylaSDK {
  readonly chat = new Chat();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_options: LaylaSDKOptions = {}) {}
}

export { LaylaSDK as Layla };
export default LaylaSDK;
