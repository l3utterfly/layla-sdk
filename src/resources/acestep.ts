/**
 * resources/acestep.ts
 * -----------------------
 * The Ace-Step resource: `layla.acestep.generateMusic()`.
 *
 * Ace-Step is an on-device music generation model. Given a text prompt (and
 * optional lyrics), the host generates a piece of music and streams progress
 * updates until the final audio arrives.
 */

import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import { type RequestOptions } from '../internal/one-shot';
import { LaylaAbortError } from '..';

type Listener =
  ((audio_data_base64: string | null) => void) |
  ((progress: number, status: string) => void);

class AceStepBridgeSink implements BridgeSink {
  private listeners: Record<string, Listener[]> = {};

  private closed = false;

  on(event: 'on_ace_step_generate_response' | 'on_ace_step_generate_progress', listener: Listener): this {
    (this.listeners[event] ||= []).push(listener);
    return this;
  }

  off(event: 'on_ace_step_generate_response' | 'on_ace_step_generate_progress', listener: Listener): this {
    const ls = this.listeners[event];
    if (ls) this.listeners[event] = ls.filter((l) => l !== listener);
    return this;
  }

  accept(event: LaylaApiEvent): boolean {
    switch (event.event) {
      case 'on_ace_step_generate_progress':
        for (const l of this.listeners['on_ace_step_generate_progress'] ?? []) {
          try {
            (l as any)(event.data.progress, event.data.status);
          } catch { }
        }

        return false; // not terminal

      case 'on_ace_step_generate_response':
        for (const l of this.listeners['on_ace_step_generate_response'] ?? []) {
          try {
            (l as any)(event.data?.audio_data_base64 || null);
          } catch { }
        }
        return true; // terminal

      default:
        return false; // not ours
    }
  }

  fail(_: Error): void {
    if (this.closed) return;
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage?(): LaylaApiRequest | null {
    return null;  // TODO: implement music generation cancelling request
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally BEFORE telling the host to stop. The terminating
    // on_message_end the host sends back must land on an already-closed sink
    // (swallowed), never re-resolve this stream.
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }
}

export class AceStep {
  /**
   * Ask the native host to generate music with the Ace-Step model. Resolves to a
   * ready-to-use base64 audio src string (including the data URI prefix), or
   * null if the host does not return audio.
   *
   * Progress updates are reported through the `onProgress` callback while the
   * host works. `progress` is a number between 0 and 1, and `status` is a
   * human-readable description of the current step.
   *
   * Pass `lyrics` to steer the vocals, and `duration` (in seconds) to control
   * the length of the generated music. When `duration` is omitted the host uses
   * its default length.
   */
  generateMusic(
    prompt: string,
    onProgress: (progress: number, status: string) => void,
    lyrics?: string,
    duration?: number,
    options?: RequestOptions
  ): Promise<string | null> {
    const setupSink = () => {
      const sink = new AceStepBridgeSink();

      if (options?.signal?.aborted) {
        // Never enqueue an already-aborted request.
        queueMicrotask(() => sink.abort(new LaylaAbortError()));
        return sink;
      }
      if (options?.signal) {
        options.signal.addEventListener(
          'abort',
          () => sink.abort(new LaylaAbortError()),
          { once: true },
        );
      }

      LaylaBridge.shared().enqueue({
        message: {
          cmd: 'ace_step_generate',
          data: {
            prompt,
            lyrics,
            duration,
          },
        },
        sink: sink,
        // Progress streams in on `on_ace_step_generate_progress` and terminates
        // on `on_ace_step_generate_response`; serialise generations in that lane.
        laneKey: 'on_ace_step_generate_response',
      });

      return sink;
    }

    return new Promise((resolve, reject) => {
      const sink = setupSink();

      sink.on('on_ace_step_generate_response', (audio_data_base64: string | null) => {
        resolve(audio_data_base64);
      });

      sink.on('on_ace_step_generate_progress', (progress, status) => {
        onProgress(progress, status);
      });

      // Handle failure (e.g., abort)
      const onFailure = (err: Error) => {
        reject(err);
      };

      // Since the current `AceStepBridgeSink` implementation doesn't call `fail` on error,
      // we can listen for aborts via the signal's 'abort' event.
      options?.signal?.addEventListener('abort', () => {
        onFailure(new LaylaAbortError());
      });
    });
  }
}
