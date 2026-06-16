/**
 * resources/memories.ts
 * ---------------------
 * Memory CRUD-ish helpers backed by the host's memory protocol endpoints.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onCreateOrUpdateMemoriesResponse,
  LaylaApiEvent_onGetMemoriesResponse,
  LaylaMemory,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export interface MemoryListOptions extends RequestOptions {
  /** Only return memories created after this timestamp. */
  minTimestamp?: number;
  /** Only return memories created before this timestamp. */
  maxTimestamp?: number;
}

export class Memories {
  /**
   * Ask the native host for memories attached to a character.
   * Results are returned newest first.
   */
  list(
    characterId: string,
    offset = 0,
    range = 10,
    options: MemoryListOptions = {},
  ): Promise<LaylaMemory[]> {
    const { minTimestamp, maxTimestamp, signal } = options;

    return oneShot<LaylaMemory[]>(
      {
        cmd: 'get_memories',
        data: {
          character_id: characterId,
          offset,
          limit: range,
          ...(minTimestamp === undefined ? {} : { min_timestamp: minTimestamp }),
          ...(maxTimestamp === undefined ? {} : { max_timestamp: maxTimestamp }),
        },
      },
      'on_get_memories_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetMemoriesResponse).data.memories ?? [],
      signal,
    );
  }

  /**
   * Create or update memories. Pass `id <= 0` to create a new memory, or an
   * existing positive id to update it.
   */
  createOrUpdate(
    memories: LaylaMemory[],
    options: RequestOptions = {},
  ): Promise<LaylaMemory[]> {
    return oneShot<LaylaMemory[]>(
      { cmd: 'create_or_update_memories', data: memories },
      'on_create_or_update_memories_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onCreateOrUpdateMemoriesResponse).data.memories ??
        [],
      options.signal,
    );
  }
}
