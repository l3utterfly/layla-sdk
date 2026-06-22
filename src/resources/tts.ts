/**
 * resources/tts.ts
 * ----------------
 * Text-to-speech helpers backed by the host's TTS protocol endpoints.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetTTSVoicesResponse,
  LaylaTTSVoice,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

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
   *
   * Resolves after the host emits `on_finished_speaking`, which indicates that
   * audio playback has completed.
   */
  generateVoice(
    ttsVoiceId: string,
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
    );
  }
}
