/**
 * internal/bridge.ts
 * ------------------
 * The single low-level transport over the WebView message channel.
 *
 * Owns one global `message` listener and serialises requests *per lane* rather
 * than globally. A lane is keyed by the response event a request waits for, so
 * every distinct surface/operation (chat `on_message_end`, db
 * `on_execute_sql_response`, tts `on_get_tts_voices_response`, ...) gets its own
 * queue and its own single active slot. Requests in different lanes run
 * concurrently; requests that would produce the *same* response event (e.g. two
 * chat generations) still serialise, because the host cannot tell two identical
 * response streams apart on its own.
 *
 * To correlate concurrent jobs the bridge stamps every outbound message with an
 * internal `id` (top-level wire field, never surfaced to callers) and routes an
 * inbound event straight to the job whose id it echoes. This is what makes
 * `on_error` — which carries no event-type of its own — attributable to the
 * exact request that failed while other lanes are in flight.
 *
 * Back-compat: a host that does not yet echo `id` produces id-less events. The
 * bridge falls back to offering such an event to each lane's active sink (the
 * owning sink recognises its response event; every other sink no-ops), and an
 * id-less `on_error` fails all active lanes, since it cannot be attributed.
 *
 * The same fallback also catches an id-*bearing* event that correlates to no
 * in-flight job. Some host notifications carry no meaningful id to echo —
 * notably `on_finished_speaking`, which the host may emit in response to a
 * bridge-bypassing `stop_speaking` (see resources/tts.ts). Such an event still
 * has to terminate the `generate_voice` request waiting on it, so an unmatched
 * id is treated like an id-less event rather than dropped. An unattributable
 * `on_error` is the exception: it is swallowed, so it cannot knock out lanes it
 * was never about.
 *
 * The bridge is intentionally event-agnostic: it routes every parsed event to a
 * job's sink and lets the sink say when it's done. The only event it
 * special-cases is `on_error`, which terminates a job. New request/response
 * shapes therefore need NO changes here.
 */

import { LaylaError, LaylaBridgeUnavailableError } from '../errors';
import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import type { LaylaApiEvent_onError } from '../protocol';

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
  /**
   * The lane this job serialises within, keyed by the response event it waits
   * for (one-shot: its `responseEvent`; streaming: `on_message_end`). Jobs in
   * different lanes run concurrently.
   */
  laneKey: string;
  /**
   * Internal correlation id, assigned by the bridge at enqueue time and stamped
   * onto the outbound wire message. Never exposed to SDK callers.
   */
  id?: string;
}

interface Lane {
  queue: BridgeJob[];
  active: BridgeJob | null;
}

export class LaylaBridge {
  private static instance: LaylaBridge | null = null;

  static shared(): LaylaBridge {
    if (!LaylaBridge.instance) LaylaBridge.instance = new LaylaBridge();
    return LaylaBridge.instance;
  }

  /** One independent queue + active slot per response-event lane. */
  private lanes = new Map<string, Lane>();
  /** In-flight jobs by their correlation id, for precise inbound routing. */
  private inflight = new Map<string, BridgeJob>();
  private listening = false;
  private idSeq = 0;

  private genId(): string {
    // Monotonic within the session; only ever compared for equality, never
    // parsed. A per-session counter is enough to correlate concurrent jobs.
    this.idSeq += 1;
    return `req-${this.idSeq}`;
  }

  private lane(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { queue: [], active: null };
      this.lanes.set(key, lane);
    }
    return lane;
  }

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

    let parsed: Partial<LaylaApiEvent> & { id?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.event !== 'string') return;

    // Precise path: the host echoed our correlation id, so route straight to
    // the one job that owns it — including on_error, which has no event-type of
    // its own to route by.
    if (typeof parsed.id === 'string') {
      const job = this.inflight.get(parsed.id);
      if (job) {
        this.deliver(job, parsed as LaylaApiEvent);
        return;
      }
      // The id matches no in-flight job. For a stray/duplicate error this is a
      // genuine no-op — and it must not fail unrelated lanes — so swallow it.
      // Any other event, though, may be an uncorrelated host notification (e.g.
      // an `on_finished_speaking` triggered by a bridge-bypassing stop) that
      // still has to terminate the request waiting on it, so fall through to
      // the name-matched fallback below rather than dropping it.
      if (parsed.event === 'on_error') return;
    }

    // Fallback path: an id-less host, or an id-bearing event that correlates to
    // no in-flight job. Offer the event to each lane's active sink; the owner
    // recognises its response event and every other sink no-ops. An id-less
    // error can't be attributed, so fail all active lanes.
    if (parsed.event === 'on_error') {
      this.failAllActive(
        new LaylaError(
          (parsed as LaylaApiEvent_onError).data?.message || 'Layla model error',
        ),
      );
      return;
    }
    for (const lane of this.lanes.values()) {
      const job = lane.active;
      if (job && job.sink.accept(parsed as LaylaApiEvent)) {
        this.finishJob(job);
        break;
      }
    }
  };

  /** Route one id-matched event to its job and free the lane if it terminates. */
  private deliver(job: BridgeJob, parsed: LaylaApiEvent): void {
    if (parsed.event === 'on_error') {
      const data = (parsed as LaylaApiEvent_onError).data;
      job.sink.fail(new LaylaError(data?.message || 'Layla model error'));
      this.finishJob(job);
      return;
    }
    if (job.sink.accept(parsed)) this.finishJob(job);
  }

  enqueue(job: BridgeJob): void {
    this.ensureListening();
    job.id = this.genId();
    this.lane(job.laneKey).queue.push(job);
    this.pump(job.laneKey);
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
   *   swallows it — instead of leaking into the next request in that lane.
   */
  cancel(sink: BridgeSink): void {
    for (const lane of this.lanes.values()) {
      const remaining = lane.queue.filter((job) => job.sink !== sink);
      if (remaining.length !== lane.queue.length) {
        lane.queue = remaining;
        return; // was queued; nothing was ever sent to the host
      }
      if (lane.active && lane.active.sink === sink) {
        const job = lane.active;
        const stop = sink.cancelMessage?.();
        if (stop) this.post(stop, job.id);
        return;
      }
    }
    // Otherwise the sink already finished — nothing to do.
  }

  private failAllActive(err: Error): void {
    for (const lane of this.lanes.values()) {
      const job = lane.active;
      if (!job) continue;
      job.sink.fail(err);
      this.finishJob(job);
    }
  }

  private finishJob(job: BridgeJob): void {
    if (job.id) this.inflight.delete(job.id);
    const lane = this.lanes.get(job.laneKey);
    if (!lane) return;
    if (lane.active === job) lane.active = null;
    if (!lane.active && lane.queue.length === 0) {
      this.lanes.delete(job.laneKey); // don't let idle lanes accumulate
    }
    this.pump(job.laneKey);
  }

  private pump(laneKey: string): void {
    const lane = this.lanes.get(laneKey);
    if (!lane || lane.active) return;
    const next = lane.queue.shift();
    if (!next) {
      if (lane.queue.length === 0) this.lanes.delete(laneKey);
      return;
    }
    if (next.sink.isClosed()) {
      // Aborted before its turn came up.
      this.pump(laneKey);
      return;
    }
    lane.active = next;
    if (next.id) this.inflight.set(next.id, next);
    this.send(next);
  }

  private send(job: BridgeJob): void {
    if (!this.post(job.message, job.id)) {
      if (job.id) this.inflight.delete(job.id);
      const lane = this.lanes.get(job.laneKey);
      if (lane && lane.active === job) lane.active = null;
      job.sink.fail(new LaylaBridgeUnavailableError());
      this.pump(job.laneKey);
    }
  }

  /**
   * Post a message to the host, stamping it with its correlation `id` so the
   * host can echo it back on the answering events. Returns false if the bridge
   * isn't present.
   */
  private post(message: LaylaApiRequest, id?: string): boolean {
    if (typeof window === 'undefined' || !window.ReactNativeWebView) return false;
    const wire = id ? { ...message, id } : message;
    window.ReactNativeWebView.postMessage(JSON.stringify(wire));
    return true;
  }
}
