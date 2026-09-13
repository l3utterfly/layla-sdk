/**
 * typetests/chat-openai-conformance.ts
 * ------------------------------------
 * Compile-time proof that the SDK's chat types line up with the official
 * `openai` package. Nothing here runs or ships — `npm run typecheck` fails if
 * any assertion below stops holding, which is the point.
 *
 * Two directions matter, and they are not the same:
 *
 *   Output (Layla -> OpenAI): what the SDK *returns* must satisfy OpenAI's
 *   response types, so code typed against the OpenAI SDK accepts it unchanged.
 *   The SDK supplies defaults for the fields OpenAI requires but Layla has no
 *   source for.
 *
 *   Params (both directions): the SDK accepts OpenAI's full request surface,
 *   so any OpenAI call site compiles unchanged. Fields Layla cannot honour are
 *   ignored at runtime, not rejected at compile time.
 */

import type {
  ChatCompletion as OpenAIChatCompletion,
  ChatCompletionAssistantMessageParam as OpenAIAssistantMessageParam,
  ChatCompletionChunk as OpenAIChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming as OpenAICreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming as OpenAICreateParamsStreaming,
  ChatCompletionDeveloperMessageParam as OpenAIDeveloperMessageParam,
  ChatCompletionMessageParam as OpenAIMessageParam,
  ChatCompletionToolMessageParam as OpenAIToolMessageParam,
  ChatCompletionSystemMessageParam as OpenAISystemMessageParam,
  ChatCompletionUserMessageParam as OpenAIUserMessageParam,
} from 'openai/resources/chat/completions';

import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from '../src/resources/chat/types';
import type { ChatCompletionStream } from '../src/resources/chat/stream';
import type { Layla } from '../src/client';

/** Fails to compile (pointing at the offending property) unless `value` fits `Target`. */
declare function expectAssignable<Target>(value: Target): void;

/* ---- output: Layla responses satisfy OpenAI's response types ------------ */

declare const completion: ChatCompletion;
declare const chunk: ChatCompletionChunk;

expectAssignable<OpenAIChatCompletion>(completion);
expectAssignable<OpenAIChatCompletionChunk>(chunk);

// ...including the nested shapes consumers actually destructure.
expectAssignable<OpenAIChatCompletion.Choice>(completion.choices[0]!);
expectAssignable<OpenAIChatCompletionChunk.Choice>(chunk.choices[0]!);
expectAssignable<OpenAIChatCompletionChunk.Choice.Delta>(chunk.choices[0]!.delta);

// The values the client hands back, not just the declared types.
declare const client: Layla;
declare const stream: ChatCompletionStream;

async function outputsAreOpenAIShaped(): Promise<void> {
  expectAssignable<OpenAIChatCompletion>(
    await client.chat.completions.create({ messages: [] }),
  );
  expectAssignable<OpenAIChatCompletion>(await stream.finalChatCompletion());
  for await (const streamed of stream) {
    expectAssignable<OpenAIChatCompletionChunk>(streamed);
  }
}

/* ---- params: OpenAI request bodies compile against the SDK unchanged ---- */

// The params are OpenAI's own, so assignability holds in BOTH directions
// (modulo `model` being optional here and the Layla-only `signal`).
declare const messageParam: ChatCompletionMessageParam;
expectAssignable<OpenAIMessageParam>(messageParam);

declare const openAIMessageParam: OpenAIMessageParam;
expectAssignable<ChatCompletionMessageParam>(openAIMessageParam);

declare const openAISystem: OpenAISystemMessageParam;
declare const openAIUser: OpenAIUserMessageParam;
declare const openAIAssistant: OpenAIAssistantMessageParam;
declare const openAITool: OpenAIToolMessageParam;
declare const openAIDeveloper: OpenAIDeveloperMessageParam;

expectAssignable<ChatCompletionMessageParam>(openAISystem);
expectAssignable<ChatCompletionMessageParam>(openAIUser);
expectAssignable<ChatCompletionMessageParam>(openAIAssistant);
// Accepted for compatibility even though the SDK drops them at the boundary.
expectAssignable<ChatCompletionMessageParam>(openAITool);
expectAssignable<ChatCompletionMessageParam>(openAIDeveloper);

declare const nonStreaming: ChatCompletionCreateParamsNonStreaming;
declare const streaming: ChatCompletionCreateParamsStreaming;

// `model` is optional here and required by OpenAI, so fill it to compare.
expectAssignable<OpenAICreateParamsNonStreaming>({
  ...nonStreaming,
  model: nonStreaming.model ?? 'layla',
});
expectAssignable<OpenAICreateParamsStreaming>({
  ...streaming,
  model: streaming.model ?? 'layla',
});

// And the reverse: a complete OpenAI request body is a valid Layla one.
declare const openAINonStreaming: OpenAICreateParamsNonStreaming;
declare const openAIStreaming: OpenAICreateParamsStreaming;
expectAssignable<ChatCompletionCreateParamsNonStreaming>(openAINonStreaming);
expectAssignable<ChatCompletionCreateParamsStreaming>(openAIStreaming);

/* ---- params: everything Layla ignores still type-checks ----------------- */

// A literal using the full OpenAI surface. None of these knobs reach the host,
// but none of them are a compile error either — that is the whole point.
expectAssignable<ChatCompletionCreateParamsNonStreaming>({
  model: 'gpt-4o',
  messages: [
    { role: 'developer', content: 'You are a helpful assistant.' },
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: [{ type: 'text', text: 'Hi.' }] },
    { role: 'tool', content: 'result', tool_call_id: 'call_1' },
    {
      role: 'user',
      content: [
        { type: 'text', text: "What's in this image?" },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' },
        },
        { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } },
        { type: 'file', file: { file_id: 'file_1' } },
      ],
    },
  ],
  temperature: 0.7,
  top_p: 0.9,
  max_completion_tokens: 256,
  n: 1,
  stop: ['\n\n'],
  seed: 42,
  presence_penalty: 0,
  frequency_penalty: 0,
  response_format: { type: 'json_object' },
  logprobs: true,
  top_logprobs: 5,
  store: true,
  metadata: { run: 'a' },
  user: 'user-123',
  tools: [
    {
      type: 'function',
      function: { name: 'get_weather', parameters: { type: 'object' } },
    },
  ],
  tool_choice: 'auto',
  parallel_tool_calls: true,
});

/* ---- the documented output narrowings stay narrow ----------------------- */

// Layla never returns `length`, `tool_calls` or `content_filter`.
declare const finishReason: ChatCompletion['choices'][number]['finish_reason'];
expectAssignable<'stop'>(finishReason);
