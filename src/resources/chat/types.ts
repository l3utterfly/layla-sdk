/**
 * resources/chat/types.ts
 * -----------------------
 * The OpenAI-shaped output and parameter types for chat completions. These are
 * the SDK's public surface for chat, not the native wire protocol.
 */

import type { LaylaChatRole } from '../../protocol';

/** A text input part in an OpenAI-style chat message. */
export interface ChatCompletionContentPartText {
  type: 'text';
  text: string;
}

/** An image input part in an OpenAI-style chat message. */
export interface ChatCompletionContentPartImage {
  type: 'image_url';
  image_url: {
    /**
     * OpenAI accepts a remote URL or a base64 data URL here. Layla requires a
     * base64 data URL so the SDK can translate it to `image_base64`.
     */
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage;

/**
 * An OpenAI-style input message accepted by the chat completions API.
 *
 * Layla's host protocol only supports one base64 image per message. The SDK
 * translates an `image_url` content part containing a base64 data URL into the
 * protocol's `image_base64` field before sending it to the host.
 */
export interface ChatCompletionMessageParam {
  role: LaylaChatRole;
  content: string | null | ChatCompletionContentPart[];
  name?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string; reasoning?: string };
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
    message: { role: 'assistant'; content: string; reasoning?: string };
    finish_reason: 'stop';
  }>;
}

export interface ChatCompletionCreateParamsBase {
  messages: ChatCompletionMessageParam[];
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
