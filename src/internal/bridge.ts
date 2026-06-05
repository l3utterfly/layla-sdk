/**
 * internal/bridge.ts
 * ------------------
 * The single low-level transport over the WebView message channel.
 *
 * Owns one global `message` listener and serialises requests, because the
 * current protocol has no request id to correlate concurrent jobs. Every job —
 * chat completions and one-shot requests alike — flows through the same queue
 * and single active slot, so a one-shot waits behind an in-flight generation
 * rather than racing it.
 *
 * The bridge is intentionally event-agnostic: it routes every parsed event to
 * the active job's sink and lets the sink say when it's done. The only event it
 * special-cases is `on_error`, which terminates any job. New request/response
 * shapes therefore need NO changes here. If you add an `id` field to both
 * `LaylaApiMessage` and `LaylaApiEvent`, this is the one place that would change
 * to support true concurrency.
 */

import { LaylaError, LaylaBridgeUnavailableError } from '../errors';
import type {
  LaylaApiEvent,
  LaylaApiEvent_onError,
  LaylaApiRequest,
} from '../protocol';

/**
 * Everything the bridge needs from a job. A sink consumes the inbound event
 * stream for the active request and reports when the request is complete.
 */
export interface BridgeSink {
  /**
   * Handle one parsed RN->web event (never `on_error`; the bridge routes that
   * to `fail`). Return `true` when this event terminates the request, so the
   * bridge can free the active slot and pump the next job. Return `false` for
   * events that are not yours or that don't end the request.
   */
  accept(event: LaylaApiEvent): boolean;

  /** Terminate the request with an error (host error, abort, missing bridge). */
  fail(err: Error): void;

  isClosed(): boolean;

  /**
   * Optional: the message to post to the host if this request is cancelled
   * while in flight. Streaming generation returns `{ cmd: 'cancel' }`; one-shot
   * requests return nothing (there's no generation to stop — they just close
   * locally and the host's eventual response frees the slot).
   */
  cancelMessage?(): LaylaApiRequest | null;
}

export interface BridgeJob {
  message: LaylaApiRequest;
  sink: BridgeSink;
}

export class LaylaBridge {
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

    if (parsed.event === 'on_error') {
      const data = (parsed as LaylaApiEvent_onError).data;
      job.sink.fail(new LaylaError(data?.message || 'Layla model error'));
      this.finishActive();
      return;
    }

    // Generic dispatch: the sink decides what to do and whether it's terminal.
    if (job.sink.accept(parsed as LaylaApiEvent)) this.finishActive();
  };

  enqueue(job: BridgeJob): void {
    this.ensureListening();
    this.queue.push(job);
    this.pump();
  }

  /**
   * Cancel a request.
   *
   * - If still queued (not yet sent), drop it; the host never sees it.
   * - If it is the active (in-flight) request, ask the sink for a stop message
   *   and post it (streaming generation -> `{ cmd: 'cancel' }`; one-shot -> none).
   *   We deliberately do NOT free the active slot here: it frees when the host
   *   sends the request's terminating event (`on_message_end` /
   *   `on_get_characters_response` / `on_error`). Holding the slot until then
   *   keeps any trailing event attributed to the (already-closed) sink — which
   *   swallows it — instead of leaking into the next request.
   */
  cancel(sink: BridgeSink): void {
    const remaining = this.queue.filter((job) => job.sink !== sink);
    if (remaining.length !== this.queue.length) {
      this.queue = remaining;
      return; // was queued; nothing was ever sent to the host
    }
    if (this.active && this.active.sink === sink) {
      const stop = sink.cancelMessage?.();
      if (stop) this.post(stop);
    }
    // Otherwise the sink already finished — nothing to do.
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
    if (!this.post(job.message)) {
      this.active = null;
      job.sink.fail(new LaylaBridgeUnavailableError());
      this.pump();
    }
  }

  /** Post a message to the host. Returns false if the bridge isn't present. */
  private post(message: LaylaApiRequest): boolean {
    if (typeof window === 'undefined' || !window.ReactNativeWebView) return false;
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
    return true;
  }
}
