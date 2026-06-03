/**
 * resources/chat/types.ts
 * -----------------------
 * The OpenAI-shaped output and parameter types for chat completions. These are
 * the SDK's public surface for chat, not the native wire protocol.
 */

import type { LaylaChatMessage } from '../../protocol';

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: 'stop' | null;
  }>;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }>;
}

export interface ChatCompletionCreateParamsBase {
  messages: LaylaChatMessage[];
  /**
   * Accepted for OpenAI compatibility. The Layla host currently picks the
   * model itself, so this is only used to populate the `model` field on the
   * returned objects unless you extend the `send_message` protocol.
   */
  model?: string;
  stream?: boolean;
  /** Abort the request from the consumer side. */
  signal?: AbortSignal;
}

export interface ChatCompletionCreateParamsNonStreaming
  extends ChatCompletionCreateParamsBase {
  stream?: false;
}

export interface ChatCompletionCreateParamsStreaming
  extends ChatCompletionCreateParamsBase {
  stream: true;
}
