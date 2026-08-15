/**
 * resources/stt.ts
 * ----------------
 * Speech-to-text helpers backed by the host's STT protocol endpoints.
 *
 * `startListening()` asks the host to begin capturing microphone audio and
 * resolves once the host confirms the recogniser has started (or rejects on
 * error/abort). Recognised speech is then delivered asynchronously through the
 * `speechRecognized` event, so subscribe with `on('speechRecognized', ...)`
 * before (or right after) calling `startListening()`.
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
  private listening = false;

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
    this.ensureListening();
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
    if (!this.hasListeners()) this.stopListening();
    return this;
  }

  private hasListeners(): boolean {
    return this.speechRecognizedListeners.size > 0;
  }

  private ensureListening(): void {
    if (this.listening || typeof window === 'undefined') return;
    window.addEventListener('message', this.onWindowMessage);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening || typeof window === 'undefined') return;
    window.removeEventListener('message', this.onWindowMessage);
    this.listening = false;
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
