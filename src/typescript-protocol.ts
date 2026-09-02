/**
 * Progress update for a `generate_image` request. The host can emit multiple progress events during the image generation process, providing updates on the current status and progress of the generation.
 */
export interface LaylaApiEvent_onGenerateImageProgress {
  event: 'on_generate_image_progress';
  data: {
    status: string; // e.g., "Generating image...", "Refining details...", etc.
    steps: number; // current step number
    total_steps: number; // total number of steps for the generation process
  };
}

/** A streamed token. `msg` is the full snapshot, `delta` is new. */
export interface LaylaApiEvent_onMsg {
  event: 'on_message';
  data: { msg: string; delta: string };
}

/**
 * Progress update for any ACE-Step request — the one-call `ace_step_generate`
 * and the raw `ace_step_lm` / `ace_step_synth` / `ace_step_understand` /
 * `ace_step_vae` passes alike. The host emits one of these per pipeline phase
 * and, inside the long phases, once per unit of work.
 *
 * `status` names the phase; `current`/`total` describe the position inside it
 * and restart whenever `status` changes. `total <= 1` marks a one-shot phase
 * with no meaningful fraction, where `current === total` means it finished.
 *
 * `progress` is the fraction of the WHOLE request: 0..1, monotonic, and the
 * right thing to drive a single bar from. It is only available where the host
 * can weigh the phases against each other, which it can for `ace_step_generate`
 * because that runs a fixed LM -> synth pipeline. Each raw command is a single
 * pass with no defined share of a larger whole, so they report `progress: null`
 * and a caller wanting a bar there should derive one from `current`/`total`.
 */
export interface LaylaApiEvent_onAceStepGenerateProgress {
  event: 'on_ace_step_generate_progress';
  data: {
    progress: number | null; // 0..1 across the whole request; null when undefined for this command
    status: string; // phase label, e.g. "Loading models", "Generating music", "Decoding audio"
    current: number; // position within the current phase
    total: number; // units in the current phase (<= 1 when indeterminate)
  };
}

export type TypescriptApiEvent =
  | LaylaApiEvent_onMsg
  | LaylaApiEvent_onGenerateImageProgress
  | LaylaApiEvent_onAceStepGenerateProgress;

export const isTypescriptApiEvent = (event: { event: string }): event is TypescriptApiEvent =>
  event.event === 'on_message' ||
  event.event === 'on_generate_image_progress' ||
  event.event === 'on_ace_step_generate_progress';
