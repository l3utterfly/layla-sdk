/**
 * resources/stt.ts
 * ----------------
 * Speech-to-text helpers backed by the host's STT protocol endpoints.
 *
 * `startListening()` asks the host to begin capturing microphone audio and
 * resolves once the host confirms the recogniser has started (or rejects on
 * error/abort). Recognised speech is then delivered asynchronously through the
 * `speechRecognized` event, so subscribe with `on('speechRecognized', ...)`
 * before (or right after) calling `startListening()`. `stopListening()` asks the
 * host to stop capturing and release the microphone.
 */

import type { LaylaApiEvent } from '../interface';
import type { LaylaApiEvent_onSTTSpeechRecognized } from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type STTSpeechRecognized = LaylaApiEvent_onSTTSpeechRecognized['data'];
export type STTSpeechRecognizedListener = (data: STTSpeechRecognized) => void;

type STTEventName = 'speechRecognized';
type STTEventListener = STTSpeechRecognizedListener;

export class STT {
  private readonly speechRecognizedListeners =
    new Set<STTSpeechRecognizedListener>();
  private subscribed = false;

  /**
   * Ask the native host to start listening for speech input using the device's
   * microphone. Resolves once the host emits `on_stt_listening_started`,
   * confirming the speech-to-text service started successfully, or rejects on
   * error/abort.
   *
   * Recognised speech arrives asynchronously through the `speechRecognized`
   * event — subscribe with `on('speechRecognized', ...)` to receive transcripts.
   */
  startListening(options: RequestOptions = {}): Promise<void> {
    return oneShot<void>(
      { cmd: 'stt_start_listening', data: null },
      'on_stt_listening_started',
      () => undefined,
      options.signal,
    );
  }

  /**
   * Ask the native host to stop listening and release the microphone. Resolves
   * once the host emits `on_stt_listening_stopped`, confirming the
   * speech-to-text service stopped, or rejects on error/abort.
   *
   * This stops the host recogniser; it does not remove your `speechRecognized`
   * subscription. Use `off('speechRecognized', ...)` to unsubscribe.
   */
  stopListening(options: RequestOptions = {}): Promise<void> {
    return oneShot<void>(
      { cmd: 'stt_stop_listening', data: null },
      'on_stt_listening_stopped',
      () => undefined,
      options.signal,
    );
  }

  /** Listen for speech recognised by the host's speech-to-text service. */
  on(event: 'speechRecognized', listener: STTSpeechRecognizedListener): this;
  on(event: STTEventName, listener: STTEventListener): this {
    switch (event) {
      case 'speechRecognized':
        this.speechRecognizedListeners.add(
          listener as STTSpeechRecognizedListener,
        );
        break;
    }
    this.attachWindowListener();
    return this;
  }

  /** Stop listening for recognised speech. */
  off(event: 'speechRecognized', listener: STTSpeechRecognizedListener): this;
  off(event: STTEventName, listener: STTEventListener): this {
    switch (event) {
      case 'speechRecognized':
        this.speechRecognizedListeners.delete(
          listener as STTSpeechRecognizedListener,
        );
        break;
    }
    if (!this.hasListeners()) this.detachWindowListener();
    return this;
  }

  private hasListeners(): boolean {
    return this.speechRecognizedListeners.size > 0;
  }

  private attachWindowListener(): void {
    if (this.subscribed || typeof window === 'undefined') return;
    window.addEventListener('message', this.onWindowMessage);
    this.subscribed = true;
  }

  private detachWindowListener(): void {
    if (!this.subscribed || typeof window === 'undefined') return;
    window.removeEventListener('message', this.onWindowMessage);
    this.subscribed = false;
  }

  private onWindowMessage = (messageEvent: MessageEvent): void => {
    if (typeof messageEvent.data !== 'string') return;

    let event: Partial<LaylaApiEvent>;
    try {
      event = JSON.parse(messageEvent.data);
    } catch {
      return;
    }

    switch (event.event) {
      case 'on_stt_recognised_speech':
        this.emit(
          this.speechRecognizedListeners,
          (event as LaylaApiEvent_onSTTSpeechRecognized).data,
        );
        break;
    }
  };

  private emit<T>(listeners: Set<(data: T) => void>, data: T): void {
    for (const listener of [...listeners]) {
      try {
        listener(data);
      } catch {
        // A consumer listener must not prevent other listeners from running.
      }
    }
  }
}
