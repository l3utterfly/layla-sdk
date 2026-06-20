/**
 * resources/personas.ts
 * ---------------------
 * Persona helpers backed by the host's persona protocol endpoint.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetPersonaResponse,
  LaylaPersona,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export class Personas {
  /**
   * Ask the native host for the default persona, or a character-specific
   * persona when a character id is provided.
   */
  get(
    characterId: string | null = null,
    options: RequestOptions = {},
  ): Promise<LaylaPersona> {
    return oneShot<LaylaPersona>(
      {
        cmd: 'get_persona',
        data: {
          character_id: characterId,
        },
      },
      'on_get_persona_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetPersonaResponse).data.persona,
      options.signal,
    );
  }
}
