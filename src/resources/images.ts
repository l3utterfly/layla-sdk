/**
 * resources/images.ts
 * -----------------------
 * The images resource: `layla.images.generateImage()`.
 * 
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetImageGenerationModelsResponse,
  LaylaApiRequest,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import { LaylaAbortError } from '..';

/** A single image generation model available on the host. */
export type LaylaImageGenerationModel =
  LaylaApiEvent_onGetImageGenerationModelsResponse['data'][number];

type Listener =
  ((image_data_base64: string | null) => void) |
  ((status: string, step: number, total_step: number) => void);

class ImagesBridgeSink implements BridgeSink {
  private listeners: Record<string, Listener[]> = {};

  private closed = false;

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
    switch (event.event) {
      case 'on_generate_image_progress':
        for (const l of this.listeners['on_generate_image_progress'] ?? []) {
          try {
            l(event.data.status, event.data.steps, event.data.total_steps);
          } catch { }
        }

        return false; // not terminal

      case 'on_generate_image_response':
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

  fail(_: Error): void {
    if (this.closed) return;
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage?(): LaylaApiRequest | null {
    return null;  // TODO: implement image cancelling request
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally BEFORE telling the host to stop. The terminating
    // on_message_end the host sends back must land on an already-closed sink
    // (swallowed), never re-resolve this stream.
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }
}

export class Images {
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
   * Ask the native host to generate an image. Resolves to a ready-to-use base64 image src string, or null if the character has no image
   *
   * Pass `modelId` to generate with a specific image model (one of the `id`s
   * returned by {@link Images.getImageGenerationModels}). When omitted, the host
   * uses its default image model.
   */
  generateImage(
    prompt: string,
    onProgress: (status: string, step: number, total_step: number) => void,
    img2img_base64?: string,
    modelId?: string,
    options?: RequestOptions
  ): Promise<string | null> {
    const setupSince = () => {
      const sink = new ImagesBridgeSink();

      if (options?.signal?.aborted) {
        // Never enqueue an already-aborted request.
        queueMicrotask(() => sink.abort(new LaylaAbortError()));
        return sink;
      }
      if (options?.signal) {
        options.signal.addEventListener(
          'abort',
          () => sink.abort(new LaylaAbortError()),
          { once: true },
        );
      }

      LaylaBridge.shared().enqueue({
        message: {
          cmd: 'generate_image',
          data: {
            prompt,
            img2img_base64,
            model_id: modelId,
          },
        },
        sink: sink,
      });

      return sink;
    }

    return new Promise((resolve, reject) => {
      const sink = setupSince();

      sink.on('on_generate_image_response', (image_data_base64: string | null) => {
        resolve(image_data_base64);
      });

      sink.on('on_generate_image_progress', (status, step, total_step) => {
        onProgress(status, step, total_step);
      });

      // Handle failure (e.g., abort)
      const onFailure = (err: Error) => {
        reject(err);
      };

      // Since the current `ImagesBridgeSink` implementation doesn't call `fail` on error,
      // we can listen for aborts via the signal's 'abort' event.
      options?.signal?.addEventListener('abort', () => {
        onFailure(new LaylaAbortError());
      });
    });
  }
}
