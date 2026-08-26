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

/**
 * Progress update for an `ace_step_generate` request. The host can emit multiple progress events during the music generation process, providing updates on the current status and progress of the generation.
 */
export interface LaylaApiEvent_onAceStepGenerateProgress {
  event: 'on_ace_step_generate_progress';
  data: {
    status: string; // e.g., "Generating music...", "Decoding audio...", etc.
    steps: number; // current step number
    total_steps: number; // total number of steps for the generation process
  };
}

/** A streamed token. `msg` is the full snapshot, `delta` is new. */
export interface LaylaApiEvent_onMsg {
  event: 'on_message';
  data: { msg: string; delta: string };
}

export type TypescriptApiEvent =
  | LaylaApiEvent_onMsg
  | LaylaApiEvent_onGenerateImageProgress
  | LaylaApiEvent_onAceStepGenerateProgress;

export const isTypescriptApiEvent = (event: { event: string }): event is TypescriptApiEvent =>
  event.event === 'on_message' ||
  event.event === 'on_generate_image_progress' ||
  event.event === 'on_ace_step_generate_progress';
