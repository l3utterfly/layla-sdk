/**
 * resources/acestep.ts
 * -----------------------
 * The Ace-Step resource: `layla.acestep.*`.
 *
 * Ace-Step is an on-device music generation model. Two levels are exposed here:
 *
 *   generateMusic()  the one-call pipeline. Prompt in, finished track out; the
 *                    host runs the LM pass and the synth pass for you.
 *
 *   lm() / synth()   the raw passes, each the equivalent of one engine
 *   understand()     endpoint. Use them when a mini-app needs the intermediate
 *   vaeEncode()      artefacts: enriched metadata and lyrics before rendering,
 *   vaeDecode()      an analysis of an existing track, or latents to reuse.
 *
 * Every command streams `on_ace_step_generate_progress` while it runs, surfaced
 * through the `onProgress` callback. The one-call pipeline knows how its phases
 * weigh against each other, so its `progress` is a 0..1 fraction of the whole
 * request; a raw pass is a single pass with no defined share of a larger whole,
 * so it reports `progress: null` and a caller wanting a bar should derive one
 * from `current`/`total`.
 *
 * All Ace-Step commands share one bridge lane, so the host is never asked to
 * run two of these heavy passes at once.
 */

import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import type {
  LaylaApiAceStepRequest,
  LaylaApiEvent_onAceStepLmResponse,
  LaylaApiEvent_onAceStepSynthResponse,
  LaylaApiEvent_onAceStepUnderstandResponse,
  LaylaApiEvent_onAceStepVaeResponse,
} from '../protocol';
import { type BridgeSink, LaylaBridge } from '../internal/bridge';
import { Deferred } from '../internal/deferred';
import { type RequestOptions } from '../internal/one-shot';
import { LaylaAbortError, LaylaError } from '../errors';

/**
 * One raw Ace-Step request: the style prompt plus every knob the model exposes.
 * Unset fields fall back to the model's own defaults, and unknown fields are
 * passed through untouched — which is what lets an enriched request returned by
 * {@link AceStep.lm} or {@link AceStep.understand} be handed straight to
 * {@link AceStep.synth}.
 */
export type AceStepRequest = LaylaApiAceStepRequest;

/** The rendered track returned by {@link AceStep.synth}. */
export type AceStepSynthResult = LaylaApiEvent_onAceStepSynthResponse['data'];

/** The analysis returned by {@link AceStep.understand}. */
export type AceStepUnderstandResult =
  LaylaApiEvent_onAceStepUnderstandResponse['data'];

/** The raw VAE result, in whichever direction the pass travelled. */
export type AceStepVaeResult = LaylaApiEvent_onAceStepVaeResponse['data'];

/** Progress for one Ace-Step command. */
export interface AceStepProgress {
  /**
   * Fraction of the WHOLE request, 0..1 and monotonic — the right thing to
   * drive a single bar from. `null` when the host cannot define a fraction,
   * which is the case for every raw pass; derive a bar from `current`/`total`
   * there instead.
   */
  progress: number | null;
  /** Phase label, e.g. `"Loading models"`, `"Generating music"`. */
  status: string;
  /** Position within the current phase. Restarts whenever `status` changes. */
  current: number;
  /**
   * Units of work in the current phase. `<= 1` marks a one-shot phase with no
   * meaningful fraction, where `current === total` means it finished.
   */
  total: number;
}

export type AceStepProgressListener = (progress: AceStepProgress) => void;

/** Options shared by every raw Ace-Step pass. */
export interface AceStepPassOptions extends RequestOptions {
  /** Called for each progress event the host emits while the pass runs. */
  onProgress?: AceStepProgressListener;
  /**
   * Run the pass on the GPU where the host supports it. Only {@link
   * AceStep.synth} acts on this today (OpenCL on Android, with CPU fallback);
   * the other passes accept it for symmetry and run on the CPU regardless.
   */
  useGpu?: boolean;
}

/** Options for {@link AceStep.lm}. */
export type AceStepLmOptions = AceStepPassOptions;

/** Options for {@link AceStep.synth}. */
export interface AceStepSynthOptions extends AceStepPassOptions {
  /** Flash attention for the synth pass (trades quality for speed on CPU). */
  useFlashAttn?: boolean;
  /** Latent frames per VAE decode tile; lower cuts peak memory. */
  vaeTileSize?: number;
}

/** Options for {@link AceStep.understand}. */
export interface AceStepUnderstandOptions extends AceStepPassOptions {
  /**
   * Sampling params only (`lm_temperature`, `lm_top_p`, `lm_top_k`, `lm_seed`).
   * Understand samples colder than generation: left unset, temperature and
   * top_p become 0.3 / 1.0.
   */
  request?: AceStepRequest;
  /**
   * Return the encoded latents alongside the analysis so a later call can skip
   * the VAE encode. Off by default: latents are large, and most callers only
   * want the analysis. Ignored when latents were the source.
   */
  returnLatents?: boolean;
  /** Flash attention for the LM stage. */
  useFlashAttn?: boolean;
  /** Latent frames per VAE encode tile. */
  vaeTileSize?: number;
}

/** Options for {@link AceStep.vaeEncode} and {@link AceStep.vaeDecode}. */
export interface AceStepVaeOptions extends AceStepPassOptions {
  /**
   * Read on decode for `output_format` (which also picks the returned
   * container), `mp3_bitrate` and `peak_clip`. Encode reads nothing from it.
   */
  request?: AceStepRequest;
  /** Latent frames per VAE tile; lower cuts peak memory. */
  vaeTileSize?: number;
}

/** The track to analyze: audio bytes, or latents from an earlier encode. */
export type AceStepUnderstandSource =
  | {
      /**
       * Track to analyze (WAV or MP3, any sample rate, max 10 minutes), base64
       * encoded. The data URI prefix is optional.
       */
      audioBase64: string;
      latentsBase64?: never;
    }
  | {
      /** Pre-encoded latents to analyze, skipping the VAE encode entirely. */
      latentsBase64: string;
      audioBase64?: never;
    };

/**
 * Every Ace-Step command serialises in this one lane. They all drive the same
 * on-device engine, so running two at once would only make both slower — and it
 * keeps `on_ace_step_generate_progress` unambiguous on hosts that do not echo
 * the bridge's correlation id.
 */
const ACE_STEP_LANE = 'ace_step';

/**
 * A sink for one Ace-Step command: forwards every progress event to the
 * listener and settles on the command's own response event, on a host error, or
 * on abort.
 */
class AceStepSink<T> implements BridgeSink {
  private closed = false;
  private readonly deferred = new Deferred<T>();

  constructor(
    private readonly responseEvent: LaylaApiEvent['event'],
    private readonly extract: (event: LaylaApiEvent) => T,
    private readonly onProgress?: AceStepProgressListener,
  ) {
    // Avoid an unhandled rejection if the caller aborts and never awaits.
    this.deferred.promise.catch(() => undefined);
  }

  get promise(): Promise<T> {
    return this.deferred.promise;
  }

  accept(event: LaylaApiEvent): boolean {
    if (event.event === 'on_ace_step_generate_progress') {
      if (this.onProgress) {
        try {
          this.onProgress({
            progress: event.data.progress,
            status: event.data.status,
            current: event.data.current,
            total: event.data.total,
          });
        } catch {
          // A throwing progress listener must not kill the request.
        }
      }
      return false; // not terminal
    }

    if (event.event !== this.responseEvent) return false; // not ours

    if (!this.closed) {
      this.closed = true;
      try {
        this.deferred.resolve(this.extract(event));
      } catch (err) {
        this.deferred.reject(
          err instanceof Error ? err : new LaylaError(String(err)),
        );
      }
    }
    // The response event always terminates this request — even post-abort,
    // where it lets the bridge reclaim the slot and swallow the late reply.
    return true;
  }

  fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.deferred.reject(err);
  }

  isClosed(): boolean {
    return this.closed;
  }

  cancelMessage(): LaylaApiRequest | null {
    return null; // TODO: implement an Ace-Step cancelling request
  }

  /** Abort from the consumer side. */
  abort(reason?: unknown): void {
    const err = reason instanceof Error ? reason : new LaylaAbortError();
    // Close locally BEFORE telling the host to stop, so the host's eventual
    // response lands on an already-closed sink (swallowed) rather than
    // re-settling this request.
    this.fail(err);
    LaylaBridge.shared().cancel(this);
  }
}

/** Enqueue one Ace-Step command and return the promise of its result. */
function aceStepRequest<T>(
  message: LaylaApiRequest,
  responseEvent: LaylaApiEvent['event'],
  extract: (event: LaylaApiEvent) => T,
  onProgress?: AceStepProgressListener,
  signal?: AbortSignal,
): Promise<T> {
  const sink = new AceStepSink<T>(responseEvent, extract, onProgress);

  if (signal?.aborted) {
    // Never enqueue an already-aborted request.
    queueMicrotask(() => sink.abort(new LaylaAbortError()));
    return sink.promise;
  }
  if (signal) {
    signal.addEventListener('abort', () => sink.abort(new LaylaAbortError()), {
      once: true,
    });
  }

  LaylaBridge.shared().enqueue({
    message,
    sink,
    laneKey: ACE_STEP_LANE,
  });

  return sink.promise;
}

export class AceStep {
  /**
   * Ask the native host to generate music with the Ace-Step model. Resolves to a
   * ready-to-use base64 audio src string (including the data URI prefix), or
   * null if the host does not return audio.
   *
   * Progress updates are reported through the `onProgress` callback while the
   * host works. `progress` is a number between 0 and 1 across the whole
   * pipeline, `status` names the current phase, and `current`/`total` give the
   * position inside that phase.
   *
   * Pass `lyrics` to steer the vocals, and `duration` (in seconds) to control
   * the length of the generated music. When `duration` is omitted the host uses
   * its default length.
   *
   * This runs the LM pass and the synth pass back to back. Use {@link
   * AceStep.lm} and {@link AceStep.synth} instead when the mini-app needs the
   * enriched request in between.
   */
  generateMusic(
    prompt: string,
    onProgress: (
      progress: number,
      status: string,
      current: number,
      total: number,
    ) => void,
    lyrics?: string,
    duration?: number,
    options?: RequestOptions,
  ): Promise<string | null> {
    return aceStepRequest<string | null>(
      {
        cmd: 'ace_step_generate',
        data: {
          prompt,
          lyrics,
          duration,
        },
      },
      'on_ace_step_generate_response',
      (event) =>
        (event as { data?: { audio_data_base64?: string | null } }).data
          ?.audio_data_base64 || null,
      onProgress
        ? (p) => onProgress(p.progress ?? 0, p.status, p.current, p.total)
        : undefined,
      options?.signal,
    );
  }

  /**
   * Run the LM pass on its own: the first half of {@link AceStep.generateMusic}.
   * Enriches one request into metadata and lyrics (plus `audio_codes` in the
   * default `'generate'` mode) without rendering any audio.
   *
   * Resolves with one enriched request per batch variant (`lm_batch_size`,
   * default 1). Each is a full request carrying the original caption alongside
   * what the LM derived, and can be passed straight to {@link AceStep.synth}.
   *
   * `request.caption` is required.
   */
  lm(
    request: AceStepRequest,
    options: AceStepLmOptions = {},
  ): Promise<AceStepRequest[]> {
    return aceStepRequest<AceStepRequest[]>(
      {
        cmd: 'ace_step_lm',
        data: {
          request,
          use_gpu: options.useGpu,
        },
      },
      'on_ace_step_lm_response',
      (event) =>
        (event as LaylaApiEvent_onAceStepLmResponse).data?.requests ?? [],
      options.onProgress,
      options.signal,
    );
  }

  /**
   * Run the synth pass on its own: the second half of {@link
   * AceStep.generateMusic}. Runs Text-Encoder, DiT and VAE, and resolves with
   * the rendered track inline, the resolved `seed` (so the run can be
   * reproduced) and the request as actually rendered.
   *
   * Normally you pass one entry from an {@link AceStep.lm} or {@link
   * AceStep.understand} result. `request.caption` is required. The returned
   * container follows `request.output_format` (`'mp3'` | `'wav16'` | `'wav24'`
   * | `'wav32'`; a bare `'wav'` is rejected).
   *
   * Nothing is written to the app's storage — pass the returned
   * `audio_data_base64` to `layla.utils.saveFile()` to keep it.
   */
  synth(
    request: AceStepRequest,
    options: AceStepSynthOptions = {},
  ): Promise<AceStepSynthResult> {
    return aceStepRequest<AceStepSynthResult>(
      {
        cmd: 'ace_step_synth',
        data: {
          request,
          use_gpu: options.useGpu,
          use_flash_attn: options.useFlashAttn,
          vae_tile_size: options.vaeTileSize,
        },
      },
      'on_ace_step_synth_response',
      (event) => (event as LaylaApiEvent_onAceStepSynthResponse).data,
      options.onProgress,
      options.signal,
    );
  }

  /**
   * Analyze an existing track: the reverse pipeline (VAE encode -> FSQ tokenize
   * -> LM). Resolves with what the track "is" — caption, lyrics, metadata and
   * `audio_codes` — as a `request` that can be handed straight to {@link
   * AceStep.synth} to re-render, cover or continue it.
   *
   * Give exactly one source: `audioBase64`, or `latentsBase64` from an earlier
   * {@link AceStep.vaeEncode} or `understand` call, which skips the VAE encode
   * and is much faster on an already-analyzed track.
   *
   * Set `returnLatents` to get the encoded latents back alongside the analysis
   * so a later call can reuse them.
   */
  understand(
    source: AceStepUnderstandSource,
    options: AceStepUnderstandOptions = {},
  ): Promise<AceStepUnderstandResult> {
    return aceStepRequest<AceStepUnderstandResult>(
      {
        cmd: 'ace_step_understand',
        data: {
          audio_data_base64: source.audioBase64,
          src_latents_base64: source.latentsBase64,
          return_latents: options.returnLatents,
          request: options.request,
          use_gpu: options.useGpu,
          use_flash_attn: options.useFlashAttn,
          vae_tile_size: options.vaeTileSize,
        },
      },
      'on_ace_step_understand_response',
      (event) => (event as LaylaApiEvent_onAceStepUnderstandResponse).data,
      options.onProgress,
      options.signal,
    );
  }

  /**
   * Run the VAE in the encode direction: audio in, latents out.
   *
   * `audioBase64` is a WAV or MP3 track (any sample rate, max 10 minutes); the
   * data URI prefix is optional. Latents come back as raw f32 `[T, 64]`
   * time-major bytes, base64 encoded — the format {@link AceStep.vaeDecode} and
   * {@link AceStep.understand}'s `latentsBase64` both accept, so an expensive
   * encode is done once and reused.
   */
  vaeEncode(
    audioBase64: string,
    options: AceStepVaeOptions = {},
  ): Promise<AceStepVaeResult> {
    return aceStepRequest<AceStepVaeResult>(
      {
        cmd: 'ace_step_vae',
        data: {
          audio_data_base64: audioBase64,
          request: options.request,
          use_gpu: options.useGpu,
          vae_tile_size: options.vaeTileSize,
        },
      },
      'on_ace_step_vae_response',
      (event) => (event as LaylaApiEvent_onAceStepVaeResponse).data,
      options.onProgress,
      options.signal,
    );
  }

  /**
   * Run the VAE in the decode direction: latents in, audio out.
   *
   * `latentsBase64` is the base64 of raw f32 `[T, 64]` time-major bytes (max
   * 15000 frames / 10 minutes), as returned by {@link AceStep.vaeEncode} or by
   * {@link AceStep.understand} with `returnLatents`. Pass `request` to pick the
   * returned container via `output_format`, plus `mp3_bitrate` and `peak_clip`.
   */
  vaeDecode(
    latentsBase64: string,
    options: AceStepVaeOptions = {},
  ): Promise<AceStepVaeResult> {
    return aceStepRequest<AceStepVaeResult>(
      {
        cmd: 'ace_step_vae',
        data: {
          latents_base64: latentsBase64,
          request: options.request,
          use_gpu: options.useGpu,
          vae_tile_size: options.vaeTileSize,
        },
      },
      'on_ace_step_vae_response',
      (event) => (event as LaylaApiEvent_onAceStepVaeResponse).data,
      options.onProgress,
      options.signal,
    );
  }
}
