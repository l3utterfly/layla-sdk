/**
 * resources/tts.ts
 * ----------------
 * Text-to-speech helpers backed by the host's TTS protocol endpoints.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGenerateVoiceToFileResponse,
  LaylaApiEvent_onGetTTSVoicesResponse,
  LaylaApiEvent_onError,
  LaylaApiStopSpeaking,
  LaylaTTSVoice,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';
import {
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
} from '../errors';

export type GenerateVoiceToFileResult =
  LaylaApiEvent_onGenerateVoiceToFileResponse['data'];

export class TTS {
  /**
   * Ask the native host for all available TTS voices installed in Layla.
   */
  getVoices(options: RequestOptions = {}): Promise<LaylaTTSVoice[]> {
    return oneShot<LaylaTTSVoice[]>(
      { cmd: 'get_tts_voices', data: null },
      'on_get_tts_voices_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetTTSVoicesResponse).data.voices ?? [],
      options.signal,
    );
  }

  /**
   * Ask the native host to generate and play voice audio for the provided text.
   * Pass `null` to use the global default TTS voice.
   *
   * Resolves after the host emits `on_finished_speaking`, which indicates that
   * audio playback has completed.
   */
  generateVoice(
    ttsVoiceId: string | null,
    text: string,
    options: RequestOptions = {},
  ): Promise<void> {
    return oneShot<void>(
      {
        cmd: 'generate_voice',
        data: {
          ttsVoiceId,
          text,
        },
      },
      'on_finished_speaking',
      () => undefined,
      options.signal,
      () => ({ cmd: 'stop_speaking', data: null }),
    );
  }

  /**
   * Generate voice audio without playing it.
   *
   * When `save` is false, the result contains `audio_data_base64` including
   * its data URI prefix. When true, the host saves the audio and returns its
   * `filename` instead.
   */
  generateVoiceToFile(
    ttsVoiceId: string | null,
    text: string,
    save = false,
    options: RequestOptions = {},
  ): Promise<GenerateVoiceToFileResult> {
    return oneShot<GenerateVoiceToFileResult>(
      {
        cmd: 'generate_voice_to_file',
        data: {
          ttsVoiceId,
          text,
          save,
        },
      },
      'on_generate_voice_to_file_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGenerateVoiceToFileResponse).data,
      options.signal,
    );
  }

  /**
   * Ask the native host to stop any in-progress voice playback.
   *
   * This control message bypasses the normal request queue so it can interrupt
   * an active `generateVoice(...)` call.
   */
  stopSpeaking(options: RequestOptions = {}): Promise<void> {
    const command: LaylaApiStopSpeaking = {
      cmd: 'stop_speaking',
      data: null,
    };

    return new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new LaylaAbortError());
        return;
      }

      if (typeof window === 'undefined' || !window.ReactNativeWebView) {
        reject(new LaylaBridgeUnavailableError());
        return;
      }

      let settled = false;
      const cleanup = () => {
        window.removeEventListener('message', onWindowMessage);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onAbort = () => {
        settle(() => reject(new LaylaAbortError()));
      };
      const onWindowMessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;

        let parsed: Partial<LaylaApiEvent>;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }

        if (parsed.event === 'on_finished_speaking') {
          settle(resolve);
          return;
        }

        if (parsed.event === 'on_error') {
          const data = (parsed as LaylaApiEvent_onError).data;
          settle(() =>
            reject(new LaylaError(data?.message || 'Layla TTS stop error')),
          );
        }
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      window.addEventListener('message', onWindowMessage);

      try {
        window.ReactNativeWebView.postMessage(JSON.stringify(command));
      } catch (error) {
        settle(() =>
          reject(error instanceof Error ? error : new LaylaError(String(error))),
        );
      }
    });
  }
}
