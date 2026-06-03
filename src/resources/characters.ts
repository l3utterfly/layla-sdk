/**
 * resources/characters.ts
 * -----------------------
 * The characters resource: `layla.characters.list()`.
 *
 * This is the template for any one-shot endpoint — a single `oneShot(...)` call
 * giving the command, the response event name, and how to read the payload.
 * Copy this file to add a new resource (e.g. `settings.ts` -> `Settings.get`).
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetCharactersResponse,
  TavernCardV2,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export class Characters {
  /**
   * Ask the native host for the available character cards. Resolves once with
   * the host's `on_get_characters_response` payload, or rejects on error/abort.
   */
  list(options: RequestOptions = {}): Promise<TavernCardV2[]> {
    return oneShot<TavernCardV2[]>(
      { cmd: 'get_characters' },
      'on_get_characters_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetCharactersResponse).data;
        return Array.isArray(data) ? data : [];
      },
      options.signal,
    );
  }
}
