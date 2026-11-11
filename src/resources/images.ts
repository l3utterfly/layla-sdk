/**
 * resources/images.ts
 * -----------------------
 * Image generation and text-only tag dictionaries on `layla.images`.
 * 
 */

import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import type {
  LaylaApiGenerateImage,
  LaylaApiEvent_onGetImageGenerationModelsResponse,
  LaylaApiEvent_onImageGenTagGetDictionariesResponse,
  LaylaApiEvent_onImageGenTagGetTagsResponse,
  LaylaApiEvent_onImageGenTagGetTagResponse,
  LaylaApiEvent_onImageGenTagUpsertTagResponse,
  LaylaApiEvent_onImageGenTagDeleteTagResponse,
  LaylaApiEvent_onImageGenTagSearchTagsResponse,
  LaylaApiEvent_onImageGenTagSuggestTagsResponse,
  LaylaImageGenTagDictionaryData,
  LaylaImageGenTag,
  LaylaImageGenTagPage,
  LaylaImageGenTagSuggestion,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import { LaylaAbortError } from '../errors';

/** Options for image generation, including native edit conditioning. */
export interface GenerateImageOptions extends RequestOptions {
  /** Base64 image data URIs. The host rejects non-empty arrays on unsupported models. */
  referenceImages?: LaylaApiGenerateImage['data']['reference_images'];
}

/** A single image generation model available on the host. */
export type LaylaImageGenerationModel =
  LaylaApiEvent_onGetImageGenerationModelsResponse['data'][number];

/** Pagination and optional category filtering within one tag dictionary. */
export interface ImageGenTagListOptions extends RequestOptions {
  /** Zero-based offset. Defaults to 0. */
  offset?: number;
  /** Maximum number of tags. Defaults to 50; zero returns only the total. */
  limit?: number;
  /** Omit or pass null to include all categories. */
  category?: number | null;
}

export interface ImageGenTagSearchOptions extends ImageGenTagListOptions {
  /** Match the start of names/aliases, or anywhere in them. Defaults to 'name'. */
  mode?: 'prefix' | 'name';
}

/** A tag page plus the query and resolved matching mode. */
export type ImageGenTagSearchResult = LaylaApiEvent_onImageGenTagSearchTagsResponse['data'];

/** Ranked autocomplete using the native prompt picker's suggestion engine. */
export interface ImageGenTagSuggestOptions extends RequestOptions {
  /** Maximum suggestions; defaults to 40, matching the picker. Zero returns none. */
  limit?: number;
}

type Listener =
  ((image_data_base64: string | null) => void) |
  ((status: string, step: number, total_step: number) => void);

class ImagesBridgeSink implements BridgeSink {
  private listeners: Record<string, Listener[]> = {};

  private closed = false;

  constructor(private readonly onFailure: (error: Error) => void) {}

  on(event: 'on_generate_image_response' | 'on_generate_image_progress', listener: Listener): this {
    (this.listeners[event] ||= []).push(listener);
    return this;
  }

  off(event: 'on_generate_image_response' | 'on_generate_image_progress', listener: Listener): this {
    const ls = this.listeners[event];
    if (ls) this.listeners[event] = ls.filter((l) => l !== listener);
    return this;
  }

  accept(event: LaylaApiEvent): boolean {
    if (this.closed) return event.event === 'on_generate_image_response';
    switch (event.event) {
      case 'on_generate_image_progress':
        for (const l of this.listeners['on_generate_image_progress'] ?? []) {
          try {
            l(event.data.status, event.data.steps, event.data.total_steps);
          } catch { }
        }

        return false; // not terminal

      case 'on_generate_image_response':
        this.closed = true;
        for (const l of this.listeners['on_generate_image_response'] ?? []) {
          try {
            (l as any)(event.data?.image_data_base64 || null);
          } catch { }
        }
        return true; // terminal

      default:
        return false; // not ours
    }
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.onFailure(error);
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage?(): LaylaApiRequest | null {
    return null;  // TODO: implement image cancelling request
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    if (this.closed) return;
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally before cancelling. The host's eventual image response
    // frees the lane while this closed sink swallows any late events.
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }
}

export class Images {
  /**
   * Suggest for the current tag token with the picker's indexed fuzzy search,
   * aliases, popularity ranking, translation search and typo correction.
   * Blank queries return []. Results are bounded, without pagination or totals.
   * For an interactive input, debounce calls as the picker does (150 ms).
   */
  suggestTags(
    dictionaryFilename: string,
    query: string,
    options: ImageGenTagSuggestOptions = {},
  ): Promise<LaylaImageGenTagSuggestion[]> {
    return oneShot(
      { cmd: 'image_gen_tag_suggest_tags', data: {
        dictionary_filename: dictionaryFilename, query, limit: options.limit ?? 40,
      } },
      'on_image_gen_tag_suggest_tags_response',
      (event) => (event as LaylaApiEvent_onImageGenTagSuggestTagsResponse).data.suggestions,
      options.signal,
    );
  }

  /** List available dictionaries as filenames relative to the host's app-data tags folder. */
  getTagDictionaries(options: RequestOptions = {}): Promise<LaylaImageGenTagDictionaryData[]> {
    return oneShot(
      { cmd: 'image_gen_tag_get_dictionaries', data: null },
      'on_image_gen_tag_get_dictionaries_response',
      (event) => (event as LaylaApiEvent_onImageGenTagGetDictionariesResponse).data,
      options.signal,
    );
  }

  /** List tags in file order. Every call identifies its dictionary independently. */
  getTags(dictionaryFilename: string, options: ImageGenTagListOptions = {}): Promise<LaylaImageGenTagPage> {
    return oneShot(
      { cmd: 'image_gen_tag_get_tags', data: {
        dictionary_filename: dictionaryFilename,
        offset: options.offset ?? 0,
        limit: options.limit ?? 50,
        category: options.category,
      } },
      'on_image_gen_tag_get_tags_response',
      (event) => (event as LaylaApiEvent_onImageGenTagGetTagsResponse).data,
      options.signal,
    );
  }

  /** Get an exact canonical English name, or null when that tag is absent. */
  getTag(dictionaryFilename: string, english: string, options: RequestOptions = {}): Promise<LaylaImageGenTag | null> {
    return oneShot(
      { cmd: 'image_gen_tag_get_tag', data: { dictionary_filename: dictionaryFilename, english } },
      'on_image_gen_tag_get_tag_response',
      (event) => (event as LaylaApiEvent_onImageGenTagGetTagResponse).data.tag,
      options.signal,
    );
  }

  /**
   * Persist a tag. Omit replacing or pass null to create a tag and, if needed,
   * its dictionary CSV and parent folders. An exact existing name replaces it,
   * including a rename. Invalid tags do not create a document.
   * Duplicate names and missing replacement targets reject with LaylaError.
   */
  upsertTag(
    dictionaryFilename: string,
    tag: LaylaImageGenTag,
    replacing: string | null = null,
    options: RequestOptions = {},
  ): Promise<LaylaImageGenTag> {
    return oneShot(
      { cmd: 'image_gen_tag_upsert_tag', data: { dictionary_filename: dictionaryFilename, tag, replacing } },
      'on_image_gen_tag_upsert_tag_response',
      (event) => (event as LaylaApiEvent_onImageGenTagUpsertTagResponse).data.tag,
      options.signal,
    );
  }

  /** Persist deletion by exact name. Returns false when the tag is already absent. */
  deleteTag(dictionaryFilename: string, english: string, options: RequestOptions = {}): Promise<boolean> {
    return oneShot(
      { cmd: 'image_gen_tag_delete_tag', data: { dictionary_filename: dictionaryFilename, english } },
      'on_image_gen_tag_delete_tag_response',
      (event) => (event as LaylaApiEvent_onImageGenTagDeleteTagResponse).data.deleted,
      options.signal,
    );
  }

  /**
   * Search names and aliases; case is ignored and spaces/dashes become
   * underscores. Exact names come first, then matches in dictionary file order.
   */
  searchTags(
    dictionaryFilename: string,
    query: string,
    options: ImageGenTagSearchOptions = {},
  ): Promise<ImageGenTagSearchResult> {
    return oneShot(
      { cmd: 'image_gen_tag_search_tags', data: {
        dictionary_filename: dictionaryFilename,
        query,
        mode: options.mode,
        offset: options.offset ?? 0,
        limit: options.limit ?? 50,
        category: options.category,
      } },
      'on_image_gen_tag_search_tags_response',
      (event) => (event as LaylaApiEvent_onImageGenTagSearchTagsResponse).data,
      options.signal,
    );
  }

  /**
   * Ask the native host for the list of image generation models that are
   * immediately available for use. Models that are not downloaded are omitted.
   *
   * Pass a returned model's `id` as the `modelId` argument to
   * {@link Images.generateImage} to generate with that specific model.
   */
  getImageGenerationModels(
    options: RequestOptions = {},
  ): Promise<LaylaImageGenerationModel[]> {
    return oneShot<LaylaImageGenerationModel[]>(
      { cmd: 'get_image_generation_models', data: null },
      'on_get_image_generation_models_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetImageGenerationModelsResponse).data ?? [],
      options.signal,
    );
  }

  /**
   * Ask the native host to generate an image. Resolves to a ready-to-use image
   * source string, or null if the host does not return an image.
   *
   * Pass `modelId` to generate with a specific image model (one of the `id`s
   * returned by {@link Images.getImageGenerationModels}). When omitted, the host
   * uses its default image model.
   *
   * Pass base64 image data URIs in `options.referenceImages` for native edit
   * conditioning. Requires a host implementing `reference_images`; a model
   * without reference image support rejects a non-empty array with LaylaError.
   * Omitted or empty references preserve ordinary generation.
   */
  generateImage(
    prompt: string,
    onProgress: (status: string, step: number, total_step: number) => void,
    img2img_base64?: string,
    modelId?: string,
    options?: GenerateImageOptions
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const cleanup = () => options?.signal?.removeEventListener('abort', onAbort);
      const sink = new ImagesBridgeSink((error) => {
        cleanup();
        reject(error);
      });
      const onAbort = () => sink.abort(new LaylaAbortError());

      // Register callbacks before enqueueing: the bridge can fail synchronously.
      sink.on('on_generate_image_response', (image_data_base64: string | null) => {
        cleanup();
        resolve(image_data_base64);
      });
      sink.on('on_generate_image_progress', (status, step, total_step) => {
        onProgress(status, step, total_step);
      });

      if (options?.signal?.aborted) {
        // Never enqueue an already-aborted request.
        queueMicrotask(onAbort);
        return;
      }
      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      LaylaBridge.shared().enqueue({
        message: {
          cmd: 'generate_image',
          data: {
            prompt,
            img2img_base64,
            model_id: modelId,
            reference_images: options?.referenceImages,
          },
        },
        sink: sink,
        // Progress streams in on `on_generate_image_progress` and terminates on
        // `on_generate_image_response`; serialise image generations in that lane.
        laneKey: 'on_generate_image_response',
      });
    });
  }
}
