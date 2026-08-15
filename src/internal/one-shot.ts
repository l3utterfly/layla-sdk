/**
 * internal/one-shot.ts
 * --------------------
 * The reusable primitive for every request/response endpoint.
 *
 * `OneShotRequest` is a Deferred wearing the BridgeSink interface: you give it
 * the command to send, the name of the event that answers it, and how to pull
 * the result out of that event. It resolves on the response event and rejects
 * on error/abort. The `oneShot` helper wires up the AbortSignal and enqueues.
 * Adding a new endpoint needs neither a new class here nor any bridge change.
 */

import { LaylaError, LaylaAbortError } from '../errors';
import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import { Deferred } from './deferred';
import { LaylaBridge, type BridgeJob, type BridgeSink } from './bridge';

/** Shared options for one-shot requests. */
export interface RequestOptions {
  /** Abort the request from the consumer side. */
  signal?: AbortSignal;
}

class OneShotRequest<T> implements BridgeSink {
  private closed = false;
  private readonly deferred = new Deferred<T>();
  readonly job: BridgeJob;

  constructor(
    command: LaylaApiRequest,
    private readonly responseEvent: LaylaApiEvent['event'],
    private readonly extract: (event: LaylaApiEvent) => T,
    private readonly cancel: (() => LaylaApiRequest | null) | null = null,
  ) {
    // Avoid an unhandled rejection if the caller aborts and never awaits.
    this.deferred.promise.catch(() => undefined);
    this.job = { message: command, sink: this };
  }

  get promise(): Promise<T> {
    return this.deferred.promise;
  }

  accept(event: LaylaApiEvent): boolean {
    if (event.event !== this.responseEvent) return false;
    if (!this.closed) {
      this.closed = true;
      try {
        this.deferred.resolve(this.extract(event));
      } catch (err) {
        this.deferred.reject(
          err instanceof Error ? err : new LaylaError(String(err)),
        );
      }
    }
    // The response event always terminates this request — even post-abort,
    // where it lets the bridge reclaim the slot and swallow the late reply.
    return true;
  }

  fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.deferred.reject(err);
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage(): LaylaApiRequest | null {
    return this.cancel?.() ?? null;
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    if (this.closed) return;
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally first, then signal the bridge (see ChatCompletionStream).
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }
}

/**
 * Fire a one-shot request and get a Promise of its result. This is all a
 * resource method needs to call.
 */
export function oneShot<T>(
  command: LaylaApiRequest,
  responseEvent: LaylaApiEvent['event'],
  extract: (event: LaylaApiEvent) => T,
  signal?: AbortSignal,
  cancelMessage?: () => LaylaApiRequest | null,
): Promise<T> {
  const req = new OneShotRequest<T>(
    command,
    responseEvent,
    extract,
    cancelMessage ?? null,
  );

  if (signal?.aborted) {
    // Never enqueue an already-aborted request.
    queueMicrotask(() => req.abort(new LaylaAbortError()));
    return req.promise;
  }
  if (signal) {
    signal.addEventListener('abort', () => req.abort(new LaylaAbortError()), {
      once: true,
    });
  }

  LaylaBridge.shared().enqueue(req.job);
  return req.promise;
}
