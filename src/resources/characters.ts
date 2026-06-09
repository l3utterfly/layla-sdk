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
  LaylaApiEvent_onGetCharacterImageResponse,
  LaylaCharacter,
  LaylaApiEvent_onUpdateCharacterResponse,
  LaylaChatHistoryEntry,
  LaylaApiEvent_onGetChatHistoryResponse,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';


export class Characters {
  /**
   * Ask the native host for the available character cards. Resolves once with
   * the host's `on_get_characters_response` payload, or rejects on error/abort.
   */
  list(offset?: number, range?: number, options?: RequestOptions): Promise<LaylaCharacter[]>;
  list(
    offset: number = 0,
    range = 10,
    options: RequestOptions = {},
  ): Promise<LaylaCharacter[]> {

    return oneShot<LaylaCharacter[]>(
      {
        cmd: 'get_characters',
        data: {
          offset: offset,
          limit: range,
        },
      },
      'on_get_characters_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetCharactersResponse).data;
        return Array.isArray(data) ? data : [];
      },
      options.signal,
    );
  }

  /**
   * Ask the native host for a character portrait. Resolves to a ready-to-use
   * image src string, or null when the character has no image.
   */
  getImage(characterId: string, options: RequestOptions = {}): Promise<string | null> {
    return oneShot<string | null>(
      { cmd: 'get_character_image', data: { character_id: characterId } },
      'on_get_character_image_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetCharacterImageResponse).data;
        return data?.image_data_base64 ?? null;
      },
      options.signal,
    );
  }

  /**
   * Ask the native host to update a character's data. Resolves once the update is successful, with the character ID. Rejects on error/abort.
   */
  update(char: LaylaCharacter, options: RequestOptions = {}): Promise<string> {
    return oneShot<string>(
      { cmd: 'update_character', data: { character_id: char.id, character_data: char.data } },
      'on_update_character_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onUpdateCharacterResponse).data;
        return data.character_id;
      },
      options.signal,
    );
  }

  /**
   * Ask the native host for a character's chat history. Resolves once with the host's `on_get_chat_history_response` payload, or rejects on error/abort.
   * Results are in reverse chronological order (newest first). Use `offset` and `range` to page through the history if needed.
   * @param characterId The ID of the character whose chat history is being requested.
   * @param offset The starting point for the chat history results.
   * @param range The number of chat history entries to retrieve.
   * @param options Additional request options.
   * @returns A promise that resolves to an array of chat history entries.
   */
  getChatHistory(characterId: string, offset: number = 0, range: number = 10, options: RequestOptions = {}): Promise<LaylaChatHistoryEntry[]> {
    return oneShot<LaylaChatHistoryEntry[]>(
      { cmd: 'get_chat_history', data: { character_id: characterId, offset, limit: range } },
      'on_get_chat_history_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetChatHistoryResponse).data;
        return data?.messages ?? [];
      },
      options.signal,
    );
  }
}
