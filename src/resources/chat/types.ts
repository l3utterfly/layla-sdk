/**
 * resources/chat/types.ts
 * -----------------------
 * The OpenAI-shaped output and parameter types for chat completions. These are
 * the SDK's public surface for chat, not the native wire protocol.
 *
 * Every type here is derived from the official `openai` package's types rather
 * than hand-written, so compatibility is enforced by the compiler. The SDK is
 * deliberately permissive in and strict out:
 *
 * - **In**: the parameter types are OpenAI's own, so any request body that
 *   type-checks against the OpenAI SDK type-checks here. How much of that body
 *   reaches the model depends on the Layla app the mini-app runs in: 7.5.0 and
 *   newer take the request untranslated, while older hosts read a narrower
 *   protocol and everything it cannot represent is accepted and ignored rather
 *   than rejected — see the notes on `ChatCompletionCreateParamsBase` and
 *   `ChatCompletionMessageParam` for the exact list. The SDK picks the route
 *   itself; call sites are identical either way.
 * - **Out**: the response types are *narrowings* of OpenAI's. Anything Layla
 *   emits is assignable to the corresponding OpenAI type, and the SDK fills in
 *   sensible defaults (`refusal: null`, `logprobs: null`) for the fields
 *   OpenAI requires but Layla has no source for, so consumer code typed
 *   against the OpenAI SDK accepts Layla's responses unchanged.
 *
 * The only additions beyond the OpenAI spec are the optional `reasoning`
 * fields (Layla surfaces `<think>` blocks separately) and `signal` on the
 * create params. Both are optional, so they do not break assignability. Tool
 * calls are OpenAI's own shape, narrowed to the function variant Layla's
 * markup can express.
 *
 * `openai` is imported for types only; the import is erased at compile time and
 * no OpenAI code ships in the bundle.
 */

import type {
  ChatCompletion as OpenAIChatCompletion,
  ChatCompletionChunk as OpenAIChatCompletionChunk,
  ChatCompletionMessageFunctionToolCall as OpenAIChatCompletionMessageFunctionToolCall,
  ChatCompletionContentPart as OpenAIChatCompletionContentPart,
  ChatCompletionContentPartImage as OpenAIChatCompletionContentPartImage,
  ChatCompletionContentPartText as OpenAIChatCompletionContentPartText,
  ChatCompletionCreateParamsBase as OpenAIChatCompletionCreateParamsBase,
  ChatCompletionMessage as OpenAIChatCompletionMessage,
  ChatCompletionMessageParam as OpenAIChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

/* ---- input parts ------------------------------------------------------- */

/** A text input part in an OpenAI-style chat message. Forwarded to the host. */
export type ChatCompletionContentPartText = OpenAIChatCompletionContentPartText;

/**
 * An image input part in an OpenAI-style chat message.
 *
 * OpenAI accepts a remote URL or a base64 data URL in `image_url.url`. On
 * Layla hosts older than 7.5.0 the protocol only has an `image_base64` field,
 * so a base64 data URL is forwarded and a remote URL is ignored.
 */
export type ChatCompletionContentPartImage =
  OpenAIChatCompletionContentPartImage;

/**
 * OpenAI's full content-part union, accepted as-is.
 *
 * Layla 7.5.0 and newer receive every part as written. Older hosts take `text`
 * parts and one `image_url` part carrying a base64 data URL; `input_audio`,
 * `file`, `refusal` parts, additional images, and remote image URLs are
 * accepted and ignored there.
 */
export type ChatCompletionContentPart = OpenAIChatCompletionContentPart;

/* ---- input messages ----------------------------------------------------- */

/**
 * OpenAI's `ChatCompletionMessageParam` union, accepted as-is, so message
 * arrays written for the OpenAI SDK can be passed straight through.
 *
 * Layla 7.5.0 and newer receive the messages exactly as written. On older
 * hosts the protocol understands `system`, `user` and `assistant`, and the SDK
 * degrades the rest rather than rejecting it:
 *
 * - `developer` is folded into `system` (it is OpenAI's rename of that role).
 * - `tool` and `function` messages are dropped: tool calling needs 7.5.0.
 * - Content parts Layla cannot represent are dropped (see
 *   {@link ChatCompletionContentPart}).
 *
 * Each dropped message or part is reported with a `console.warn`, so nothing
 * disappears silently.
 */
export type ChatCompletionMessageParam = OpenAIChatCompletionMessageParam;

/* ---- tool calls --------------------------------------------------------- */

/**
 * A tool call on a finished assistant message. Narrows OpenAI's union to the
 * function variant: Layla's markup carries a name and its arguments, which is
 * a function call and never a custom-tool one.
 *
 * `id` is the host's `tool_call_id` — quote it back as `tool_call_id` on the
 * `tool` message answering this call. It is `''` when the model behind the
 * host issued a call with no id of its own, which no `tool` message can be
 * paired to.
 */
export type ChatCompletionMessageToolCall =
  OpenAIChatCompletionMessageFunctionToolCall;

/**
 * A tool call as it arrives on a stream. Layla emits one of these per call,
 * whole, when the call closes — the host writes its `tool_call_id` last, so
 * there is nothing a consumer could act on before then. The shape is OpenAI's
 * (arguments may arrive in fragments there), so the usual accumulate-by-`index`
 * consumer code works unchanged.
 */
export type ChatCompletionToolCallDelta =
  OpenAIChatCompletionChunk.Choice.Delta.ToolCall;

/**
 * Why a completion stopped. Layla stops naturally, is cancelled, or stops to
 * call the tools the request declared; it never runs out of length.
 */
export type ChatCompletionFinishReason = 'stop' | 'tool_calls';

/* ---- streamed output ---------------------------------------------------- */

/**
 * A streamed delta. Narrows OpenAI's delta to the assistant role and adds the
 * Layla-only `reasoning` field carrying the text inside `<think>` blocks.
 */
export interface ChatCompletionChunkDelta
  extends OpenAIChatCompletionChunk.Choice.Delta {
  role?: 'assistant';
  /**
   * Layla extension, not part of the OpenAI spec: reasoning text extracted
   * from `<think>` blocks. Optional, so this type stays assignable to
   * OpenAI's delta.
   */
  reasoning?: string;
}

/** A streamed choice. Layla always emits a single choice at index 0. */
export interface ChatCompletionChunkChoice
  extends Omit<
    OpenAIChatCompletionChunk.Choice,
    'delta' | 'finish_reason'
  > {
  delta: ChatCompletionChunkDelta;
  /** See {@link ChatCompletionFinishReason}; `null` until the last chunk. */
  finish_reason: ChatCompletionFinishReason | null;
}

export interface ChatCompletionChunk
  extends Omit<OpenAIChatCompletionChunk, 'choices'> {
  choices: ChatCompletionChunkChoice[];
}

/* ---- final output ------------------------------------------------------- */

/**
 * The assistant message on a finished completion. Narrows OpenAI's
 * `content: string | null` to `string` (Layla always produces text) and adds
 * the Layla-only `reasoning` field. `refusal` is always `null`: Layla has no
 * refusal channel, but OpenAI requires the field, so the SDK supplies it.
 */
export interface ChatCompletionMessage extends OpenAIChatCompletionMessage {
  /**
   * Narrowed from OpenAI's `string | null`. A reply that was nothing but tool
   * calls has no prose, and that is `''` here rather than OpenAI's `null`.
   */
  content: string;
  /** Layla extension, not part of the OpenAI spec. */
  reasoning?: string;
  /**
   * The tools this reply asked for, present only when it asked for any — in
   * which case `finish_reason` is `'tool_calls'`. Always function calls; see
   * {@link ChatCompletionMessageToolCall}.
   */
  tool_calls?: ChatCompletionMessageToolCall[];
}

/**
 * A finished choice. `logprobs` is always `null`: Layla does not expose token
 * log probabilities, but OpenAI requires the field, so the SDK supplies it.
 */
export interface ChatCompletionChoice
  extends Omit<OpenAIChatCompletion.Choice, 'finish_reason' | 'message'> {
  finish_reason: ChatCompletionFinishReason;
  message: ChatCompletionMessage;
}

export interface ChatCompletion
  extends Omit<OpenAIChatCompletion, 'choices'> {
  choices: ChatCompletionChoice[];
}

/* ---- create params ------------------------------------------------------ */

/**
 * OpenAI's request body, with `model` relaxed to optional and a Layla-only
 * `signal`. Every OpenAI field is accepted so existing OpenAI call sites
 * compile unchanged.
 *
 * Layla 7.5.0 and newer receive this body verbatim, so `temperature`,
 * `model`, `tools` and the rest are the host's to interpret. Older hosts only
 * consume `messages`: the remaining fields — `temperature`, `top_p`,
 * `max_tokens`, `max_completion_tokens`, `n`, `stop`, `seed`, `tools`,
 * `tool_choice`, `response_format`, `logprobs`, `modalities`, `metadata`,
 * `store` and the rest — are accepted for compatibility and ignored there,
 * with sampling and tool behaviour decided by the host and `model` only echoed
 * back on the returned objects.
 *
 * `signal` never goes to the host on either route, and `stream` is the SDK's
 * to decide: a completion is always generated as a stream and `stream: false`
 * only means the SDK collects it before resolving.
 */
export interface ChatCompletionCreateParamsBase
  extends Omit<OpenAIChatCompletionCreateParamsBase, 'model' | 'stream'> {
  /**
   * Optional here, unlike OpenAI, where it is required. Defaults to `'layla'`
   * on the returned objects.
   */
  model?: OpenAIChatCompletionCreateParamsBase['model'];
  stream?: boolean | null;
  /**
   * Layla extension: abort the request from the consumer side. The OpenAI SDK
   * takes this in a second `RequestOptions` argument instead.
   */
  signal?: AbortSignal;
}

export interface ChatCompletionCreateParamsNonStreaming
  extends ChatCompletionCreateParamsBase {
  stream?: false | null;
}

export interface ChatCompletionCreateParamsStreaming
  extends ChatCompletionCreateParamsBase {
  stream: true;
}
