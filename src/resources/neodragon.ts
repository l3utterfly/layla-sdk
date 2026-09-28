/**
 * The NeoDragon video-generation resource:
 * `layla.neodragon.generateVideo()`.
 */

import { LaylaAbortError, LaylaError } from '../errors';
import { Deferred } from '../internal/deferred';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import type { RequestOptions } from '../internal/one-shot';
import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import type {
  LaylaApiEvent_onNeodragonGenerateVideoResponse,
  LaylaApiNeodragonGenerateVideo,
} from '../protocol';
import type { LaylaApiEvent_onNeodragonGenerateVideoProgress } from '../typescript-protocol';

/** Normalized source region used before NeoDragon's 16:10 center crop. */
export type NeoDragonCrop = NonNullable<
  LaylaApiNeodragonGenerateVideo['data']['crop']
>;

/** One progress milestone reported by the NeoDragon engine. */
export type NeoDragonProgress =
  LaylaApiEvent_onNeodragonGenerateVideoProgress['data'];

export type NeoDragonProgressListener = (progress: NeoDragonProgress) => void;

/** Options for {@link NeoDragon.generateVideo}. */
export interface NeoDragonGenerateVideoOptions extends RequestOptions {
  /** Omit for a random seed; zero is a valid, reproducible seed. */
  seed?: number;
  /** Upscale to 1024x640 (default) instead of the native 512x320. */
  upscale?: boolean;
  /** MP4 playback rate, from 1 through 60. Defaults to 24. */
  fps?: number;
  /** Append NeoDragon's cinematic prompt modifier. Defaults to true. */
  cinematicPrompt?: boolean;
  /** Normalized source region used before NeoDragon's 16:10 center crop. */
  crop?: NeoDragonCrop;
  /** Receive engine-stage progress while generation is running. */
  onProgress?: NeoDragonProgressListener;
}

/** The generated MP4 and the resolved generation metadata. */
export type NeoDragonGenerateVideoResult =
  LaylaApiEvent_onNeodragonGenerateVideoResponse['data'];

/**
 * NeoDragon requests share one lane because progress events from hosts that do
 * not echo a correlation id cannot otherwise be attributed safely.
 */
const NEODRAGON_LANE = 'neodragon';

class NeoDragonSink implements BridgeSink {
  private closed = false;
  private readonly deferred = new Deferred<NeoDragonGenerateVideoResult>();

  constructor(private readonly onProgress?: NeoDragonProgressListener) {
    // Avoid an unhandled rejection if the caller aborts and never awaits.
    this.deferred.promise.catch(() => undefined);
  }

  get promise(): Promise<NeoDragonGenerateVideoResult> {
    return this.deferred.promise;
  }

  accept(event: LaylaApiEvent): boolean {
    if (event.event === 'on_neodragon_generate_video_progress') {
      if (!this.closed && this.onProgress) {
        try {
          this.onProgress({ ...event.data });
        } catch {
          // A throwing progress listener must not terminate the request.
        }
      }
      return false;
    }

    if (event.event !== 'on_neodragon_generate_video_response') return false;

    if (!this.closed) {
      this.closed = true;
      try {
        this.deferred.resolve(event.data);
      } catch (error) {
        this.deferred.reject(
          error instanceof Error ? error : new LaylaError(String(error)),
        );
      }
    }

    // A late response after an abort still frees the bridge lane.
    return true;
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.deferred.reject(error);
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage(): LaylaApiRequest | null {
    return null;
  }

  abort(reason?: unknown): void {
    const error = reason instanceof Error ? reason : new LaylaAbortError();
    this.fail(error);
    LaylaBridge.shared().cancel(this);
  }
}

export class NeoDragon {
  /**
   * Generate an MP4 video from a still image with NeoDragon.
   *
   * `imageDataBase64` must include its data URI prefix. The result's
   * `video_data_base64` is also a ready-to-use data URI.
   */
  generateVideo(
    imageDataBase64: string,
    prompt: string,
    options: NeoDragonGenerateVideoOptions = {},
  ): Promise<NeoDragonGenerateVideoResult> {
    const {
      signal,
      onProgress,
      seed,
      upscale,
      fps,
      cinematicPrompt,
      crop,
    } = options;
    const sink = new NeoDragonSink(onProgress);

    if (signal?.aborted) {
      queueMicrotask(() => sink.abort(new LaylaAbortError()));
      return sink.promise;
    }
    if (signal) {
      signal.addEventListener(
        'abort',
        () => sink.abort(new LaylaAbortError()),
        { once: true },
      );
    }

    LaylaBridge.shared().enqueue({
      message: {
        cmd: 'neodragon_generate_video',
        data: {
          image_data_base64: imageDataBase64,
          prompt,
          seed,
          upscale,
          fps,
          cinematic_prompt: cinematicPrompt,
          crop,
        },
      },
      sink,
      laneKey: NEODRAGON_LANE,
    });

    return sink.promise;
  }
}
