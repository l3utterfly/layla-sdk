/**
 * Background audio player controls and events.
 *
 * Control methods are fire-and-forget at the host protocol level. Their
 * promises resolve once the command has been posted to the Layla WebView
 * bridge; player state is reported through this resource's events.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onBackgroundAudioFinished,
  LaylaApiEvent_onBackgroundAudioStatus,
  LaylaApiEvent_onBackgroundAudioTrackChanged,
  LaylaApiRequest,
  LaylaApiStartBackgroundAudioPlayer,
} from '../protocol';
import { LaylaBridgeUnavailableError, LaylaError } from '../errors';

export type BackgroundAudioMetadata = NonNullable<
  LaylaApiStartBackgroundAudioPlayer['data']['metadata']
>;
export type BackgroundAudioTrackChanged =
  LaylaApiEvent_onBackgroundAudioTrackChanged['data'];
export type BackgroundAudioStatus =
  LaylaApiEvent_onBackgroundAudioStatus['data'];
export type BackgroundAudioFinished =
  LaylaApiEvent_onBackgroundAudioFinished['data'];

export type BackgroundAudioTrackChangedListener = (
  data: BackgroundAudioTrackChanged,
) => void;
export type BackgroundAudioStatusListener = (
  data: BackgroundAudioStatus,
) => void;
export type BackgroundAudioFinishedListener = (
  data: BackgroundAudioFinished,
) => void;

type BackgroundAudioEventName = 'trackChanged' | 'status' | 'finished';
type BackgroundAudioEventListener =
  | BackgroundAudioTrackChangedListener
  | BackgroundAudioStatusListener
  | BackgroundAudioFinishedListener;

export class BackgroundAudio {
  private readonly trackChangedListeners =
    new Set<BackgroundAudioTrackChangedListener>();
  private readonly statusListeners = new Set<BackgroundAudioStatusListener>();
  private readonly finishedListeners =
    new Set<BackgroundAudioFinishedListener>();
  private listening = false;

  /** Start playback, replacing any existing background-audio queue. */
  start(
    queueAudioFiles: string[],
    metadata?: BackgroundAudioMetadata,
  ): Promise<void> {
    return this.post({
      cmd: 'start_background_audio_player',
      data: {
        queueAudioFiles,
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  /** Stop playback, clear the queue, and release the player. */
  stop(): Promise<void> {
    return this.post({ cmd: 'stop_background_audio_player', data: null });
  }

  /** Pause playback while retaining the queue and current position. */
  pause(): Promise<void> {
    return this.post({ cmd: 'pause_background_audio_player', data: null });
  }

  /** Resume a paused player from its current position. */
  resume(): Promise<void> {
    return this.post({ cmd: 'resume_background_audio_player', data: null });
  }

  /** Skip to a zero-based queue index, or to the next track when omitted. */
  skip(index?: number): Promise<void> {
    return this.post({
      cmd: 'skip_background_audio_track',
      data: index === undefined ? {} : { index },
    });
  }

  on(
    event: 'trackChanged',
    listener: BackgroundAudioTrackChangedListener,
  ): this;
  on(event: 'status', listener: BackgroundAudioStatusListener): this;
  on(event: 'finished', listener: BackgroundAudioFinishedListener): this;
  on(
    event: BackgroundAudioEventName,
    listener: BackgroundAudioEventListener,
  ): this {
    switch (event) {
      case 'trackChanged':
        this.trackChangedListeners.add(
          listener as BackgroundAudioTrackChangedListener,
        );
        break;
      case 'status':
        this.statusListeners.add(listener as BackgroundAudioStatusListener);
        break;
      case 'finished':
        this.finishedListeners.add(listener as BackgroundAudioFinishedListener);
        break;
    }
    this.ensureListening();
    return this;
  }

  off(
    event: 'trackChanged',
    listener: BackgroundAudioTrackChangedListener,
  ): this;
  off(event: 'status', listener: BackgroundAudioStatusListener): this;
  off(event: 'finished', listener: BackgroundAudioFinishedListener): this;
  off(
    event: BackgroundAudioEventName,
    listener: BackgroundAudioEventListener,
  ): this {
    switch (event) {
      case 'trackChanged':
        this.trackChangedListeners.delete(
          listener as BackgroundAudioTrackChangedListener,
        );
        break;
      case 'status':
        this.statusListeners.delete(listener as BackgroundAudioStatusListener);
        break;
      case 'finished':
        this.finishedListeners.delete(
          listener as BackgroundAudioFinishedListener,
        );
        break;
    }
    if (!this.hasListeners()) this.stopListening();
    return this;
  }

  private post(command: LaylaApiRequest): Promise<void> {
    if (typeof window === 'undefined' || !window.ReactNativeWebView) {
      return Promise.reject(new LaylaBridgeUnavailableError());
    }

    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(command));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new LaylaError(String(error)),
      );
    }
  }

  private hasListeners(): boolean {
    return (
      this.trackChangedListeners.size > 0 ||
      this.statusListeners.size > 0 ||
      this.finishedListeners.size > 0
    );
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
      case 'on_background_audio_track_changed':
        this.emit(
          this.trackChangedListeners,
          (event as LaylaApiEvent_onBackgroundAudioTrackChanged).data,
        );
        break;
      case 'on_background_audio_status':
        this.emit(
          this.statusListeners,
          (event as LaylaApiEvent_onBackgroundAudioStatus).data,
        );
        break;
      case 'on_background_audio_finished':
        this.emit(
          this.finishedListeners,
          (event as LaylaApiEvent_onBackgroundAudioFinished).data,
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
