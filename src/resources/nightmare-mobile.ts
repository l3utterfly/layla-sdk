import { LaylaAbortError } from '../errors';
import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import { Deferred } from '../internal/deferred';
import { oneShot, type RequestOptions } from '../internal/one-shot';
import type {
  LaylaApiNightmareMobileGenerateVideo,
  LaylaApiEvent_onNightmareMobileGenerateVideoResponse,
  LaylaApiEvent_onNightmareMobileGetModelsResponse,
} from '../protocol';
import type { LaylaApiEvent_onNightmareMobileGenerateVideoProgress } from '../typescript-protocol';

/** One catalog model, its download state, and advisory UI capabilities. */
export type NightmareMobileModel = LaylaApiEvent_onNightmareMobileGetModelsResponse['data'][number];
export type NightmareMobileProgress = LaylaApiEvent_onNightmareMobileGenerateVideoProgress['data'];
export type NightmareMobileProgressListener = (progress: NightmareMobileProgress) => void;
export type NightmareMobileGenerateVideoResult =
  LaylaApiEvent_onNightmareMobileGenerateVideoResponse['data'];

type VideoData = LaylaApiNightmareMobileGenerateVideo['data'];

/** Supplied values override the latest UI-saved sdcpp.json; omitted values are inherited. */
export interface NightmareMobileGenerateVideoOptions extends RequestOptions {
  negativePrompt?: VideoData['negative_prompt'];
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  /** -1 for random. Use a decimal string for seeds beyond JavaScript's safe integer range. */
  seed?: VideoData['seed'];
  /** Base64 image data URI; omit to retain the UI-saved start image. */
  imageDataBase64?: VideoData['image_data_base64'];
  /** Base64 image data URI; omit to retain the UI-saved end image. */
  endImageDataBase64?: VideoData['end_image_data_base64'];
  denoiseStrength?: VideoData['denoise_strength'];
  onProgress?: NightmareMobileProgressListener;
}

class NightmareMobileSink implements BridgeSink {
  private closed = false;
  private readonly deferred = new Deferred<NightmareMobileGenerateVideoResult>();

  constructor(private readonly onProgress?: NightmareMobileProgressListener) {
    this.deferred.promise.catch(() => undefined);
  }

  get promise(): Promise<NightmareMobileGenerateVideoResult> {
    return this.deferred.promise;
  }

  accept(event: LaylaApiEvent): boolean {
    if (event.event === 'on_nightmaremobile_generate_video_progress') {
      if (!this.closed) {
        try {
          this.onProgress?.({ ...event.data });
        } catch {
          // Consumer progress callbacks do not terminate generation.
        }
      }
      return false;
    }
    if (event.event !== 'on_nightmaremobile_generate_video_response') return false;
    if (!this.closed) {
      this.closed = true;
      this.deferred.resolve(event.data);
    }
    // A late terminal response after local cancellation still releases the lane.
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
    return null; // The host protocol has no WAN cancellation command.
  }

  abort(): void {
    if (this.closed) return;
    this.fail(new LaylaAbortError());
    LaylaBridge.shared().cancel(this);
  }
}

/** Nightmare Mobile WAN model discovery and text/image-to-video generation. */
export class NightmareMobile {
  /** Includes models not yet downloaded. Capabilities describe the UI and do not constrain API inputs. */
  getModels(options: RequestOptions = {}): Promise<NightmareMobileModel[]> {
    return oneShot<NightmareMobileModel[]>(
      { cmd: 'nightmaremobile_get_models', data: null },
      'on_nightmaremobile_get_models_response',
      (event) => (event as LaylaApiEvent_onNightmareMobileGetModelsResponse).data,
      options.signal,
    );
  }

  /**
   * Generate an MP4 using a downloaded model's latest UI-saved configuration.
   * Only supplied public controls are forwarded; LoRAs and sampling stay in the
   * saved config. Model capabilities are advisory, with basic validation on the
   * host. The result includes a ready-to-use MP4 data URI and a string seed.
   * Aborting rejects locally; native generation continues until its terminal event.
   */
  generateVideo(
    modelId: string,
    prompt: string,
    options: NightmareMobileGenerateVideoOptions = {},
  ): Promise<NightmareMobileGenerateVideoResult> {
    const sink = new NightmareMobileSink(options.onProgress);
    const onAbort = () => sink.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    void sink.promise.then(cleanup, cleanup);
    if (options.signal?.aborted) {
      queueMicrotask(onAbort);
      return sink.promise;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    LaylaBridge.shared().enqueue({
      message: {
        cmd: 'nightmaremobile_generate_video',
        data: {
          model_id: modelId,
          prompt,
          negative_prompt: options.negativePrompt,
          width: options.width,
          height: options.height,
          frames: options.frames,
          fps: options.fps,
          seed: options.seed,
          image_data_base64: options.imageDataBase64,
          end_image_data_base64: options.endImageDataBase64,
          denoise_strength: options.denoiseStrength,
        },
      },
      sink,
      laneKey: 'nightmaremobile',
    });
    return sink.promise;
  }
}
