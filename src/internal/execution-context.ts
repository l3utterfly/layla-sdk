/**
 * internal/execution-context.ts
 * -----------------------------
 * The shared `get_execution_context` fetch.
 *
 * The execution context cannot change while the mini-app runs, so the host is
 * asked once and every later reader resolves from the same in-memory copy.
 * Both `contextual.getExecutionContext()` and the chat resource's host-version
 * probe read through here, so they cost one host round-trip between them.
 */

import { LaylaAbortError } from '../errors';
import type { LaylaApiEvent } from '../interface';
import type {
  LaylaApiEvent_onGetExecutionContextResponse,
  LaylaExecutionContext,
} from '../protocol';
import { oneShot } from './one-shot';

/** The context, once the host has answered: it cannot change while we run. */
let cached: LaylaExecutionContext | null = null;
/** The in-flight fetch, shared by concurrent callers and cleared on failure. */
let inFlight: Promise<LaylaExecutionContext> | null = null;

/**
 * Ask the host for the context in which this mini-app is running, asking at
 * most once per session.
 */
export function getExecutionContext(
  signal?: AbortSignal,
): Promise<LaylaExecutionContext> {
  if (cached) return Promise.resolve(cached);

  if (!inFlight) {
    // Deliberately unsignalled: this request is shared by every caller, so one
    // caller's abort must not cancel it for the others. Their signals are
    // honoured individually by `withAbort` below.
    const request = oneShot<LaylaExecutionContext>(
      { cmd: 'get_execution_context', data: null },
      'on_get_execution_context_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetExecutionContextResponse).data,
    ).then(
      (context) => {
        cached = context;
        inFlight = null;
        return context;
      },
      (err: unknown) => {
        // Cache the context, never the failure: let a later call retry.
        inFlight = null;
        throw err;
      },
    );
    // A caller that aborts must not leave this shared promise unhandled.
    request.catch(() => undefined);
    inFlight = request;
  }

  return withAbort(inFlight, signal);
}

/**
 * Settle with `promise`, or reject as soon as `signal` aborts — leaving the
 * underlying promise (which other callers share) running either way.
 */
export function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new LaylaAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new LaylaAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}
