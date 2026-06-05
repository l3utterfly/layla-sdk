---
name: layla-sdk
description: Use the @layla-network/sdk package in third-party Layla mini-apps and WebView apps. Covers the public API surface for creating a Layla client, OpenAI-shaped chat completions and streams, character listing and character images, image generation progress/results, abort handling, SDK errors, exported TypeScript types, and runtime expectations inside the Layla WebView.
---

# Layla SDK

Use `@layla-network/sdk` when building a third-party Layla mini-app that runs inside the Layla WebView and needs to call the on-device Layla host.

The SDK exposes a small OpenAI-shaped API. Import only from the package root:

```ts
import LaylaSDK, {
  Layla,
  LaylaError,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  type LaylaChatMessage,
  type LaylaCharacter,
  type TavernCardV2,
} from '@layla-network/sdk';
```

`LaylaSDK`, `Layla`, and the default export are aliases for the same client class. Use the named `LaylaSDK` import instead if a project avoids default imports:

```ts
import { LaylaSDK } from '@layla-network/sdk';
```

```ts
const layla = new LaylaSDK();
```

The constructor accepts an optional `LaylaSDKOptions` object:

```ts
const layla = new LaylaSDK({ model: 'layla' });
```

`model` is currently reserved for compatibility/future use. The Layla host chooses the actual model.

## Runtime

Run SDK calls inside the Layla WebView. The host injects `window.ReactNativeWebView.postMessage`; if that bridge is unavailable, requests reject with `LaylaBridgeUnavailableError`.

Do not use SDK calls as ordinary browser HTTP calls. There is no API key, base URL, or fetch endpoint to configure. The SDK sends messages to the Layla host bridge.

## Chat

Use `layla.chat.completions.create(...)` for a final response, or `layla.chat.completions.stream(...)` for live tokens.

Messages use the OpenAI chat shape:

```ts
const messages: LaylaChatMessage[] = [
  { role: 'system', content: 'You are concise and helpful.' },
  { role: 'user', content: 'Write a tiny haiku about chess.' },
];
```

Allowed roles are `'system'`, `'user'`, and `'assistant'`. `content` is `string | null`; `name` is optional.

### Non-streaming chat

```ts
const completion = await layla.chat.completions.create({
  messages,
});

const text = completion.choices[0]?.message.content ?? '';
```

The returned object is OpenAI-shaped:

```ts
type ChatCompletion = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }>;
};
```

You may pass `model`; it is reflected in returned objects and defaults to `'layla'`.

```ts
await layla.chat.completions.create({
  model: 'layla',
  messages,
});
```

### Streaming chat

Prefer `.stream(...)` when updating UI as tokens arrive. It returns a `ChatCompletionStream` synchronously so listeners can be attached immediately.

```ts
const stream = layla.chat.completions.stream({ messages });

stream.on('content', (delta, snapshot) => {
  // delta is the newest text; snapshot is the full assistant response so far.
  setAssistantText(snapshot);
});

stream.on('end', () => {
  setBusy(false);
});

stream.on('error', (err) => {
  console.error(err);
  setBusy(false);
});

const finalText = await stream.finalContent();
```

The stream is also async iterable:

```ts
const stream = layla.chat.completions.stream({ messages });

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content ?? '';
  append(delta);
}
```

Breaking out of `for await` aborts the request.

`create({ stream: true, messages })` returns a `Promise<ChatCompletionStream>`:

```ts
const stream = await layla.chat.completions.create({
  messages,
  stream: true,
});
```

Streaming chunks are OpenAI-shaped:

```ts
type ChatCompletionChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string };
    finish_reason: 'stop' | null;
  }>;
};
```

`ChatCompletionStream` methods:

- `on('content', (delta, snapshot) => void)`: listen to text deltas.
- `on('chunk', (chunk) => void)`: listen to full OpenAI-shaped chunks.
- `on('end', () => void)`: listen for normal completion.
- `on('error', (err) => void)`: listen for failures or aborts.
- `off(event, listener)`: remove a listener.
- `abort(reason?)`: abort the request from the mini-app.
- `finalContent()`: resolve with the final assistant text.
- `finalChatCompletion()`: resolve with the final `ChatCompletion`.

## Characters

Use `layla.characters.list()` to get the user's available Layla character cards.

```ts
const characters = await layla.characters.list();

for (const character of characters) {
  console.log(character.id, character.data.data.name);
}
```

Each item is:

```ts
type LaylaCharacter = {
  id: string;
  data: TavernCardV2;
};
```

`TavernCardV2` follows Character Card V2 (`spec: 'chara_card_v2'`, `spec_version: '2.0'`). Common fields live under `character.data.data`, including:

- `name`
- `description`
- `personality`
- `scenario`
- `first_mes`
- `mes_example`
- `system_prompt`
- `post_history_instructions`
- `alternate_greetings`
- `tags`
- `creator`
- `extensions`
- optional `character_book`

Use `layla.characters.getImage(characterId)` to get a character portrait.

```ts
const imageSrc = await layla.characters.getImage(character.id);

if (imageSrc) {
  imageElement.src = imageSrc;
}
```

The result is `Promise<string | null>`. When present, the string is a ready-to-use image source containing base64 data and the data URI prefix.

## Images

Use `layla.images.generateImage(prompt, onProgress, options?)` to generate an image from text.

```ts
const imageSrc = await layla.images.generateImage(
  'A cozy pixel-art study with warm lamplight',
  (status, step, totalSteps) => {
    setProgress({ status, step, totalSteps });
  },
);

if (imageSrc) {
  imageElement.src = imageSrc;
}
```

The result is `Promise<string | null>`. When present, the string is a ready-to-use image source containing base64 data and the data URI prefix. `null` means the host did not return an image.

Progress callbacks receive:

- `status: string`
- `step: number`
- `totalSteps: number`

## Abort Handling

Chat, character requests, and image generation accept abort signals.

```ts
const controller = new AbortController();

const promise = layla.characters.list({
  signal: controller.signal,
});

controller.abort();

try {
  await promise;
} catch (err) {
  if (err instanceof LaylaAbortError) {
    // Request was cancelled by the app.
  }
}
```

For streaming chat, either pass `signal` or call `stream.abort()`:

```ts
const controller = new AbortController();
const stream = layla.chat.completions.stream({
  messages,
  signal: controller.signal,
});

controller.abort();
// or
stream.abort();
```

For one-shot requests, use:

```ts
await layla.characters.list({ signal });
await layla.characters.getImage(characterId, { signal });
await layla.images.generateImage(prompt, onProgress, { signal });
```

## Errors

All SDK-specific errors extend `LaylaError`.

```ts
try {
  const completion = await layla.chat.completions.create({ messages });
} catch (err) {
  if (err instanceof LaylaAbortError) {
    return;
  }

  if (err instanceof LaylaBridgeUnavailableError) {
    showMessage('This mini-app must run inside Layla.');
    return;
  }

  if (err instanceof LaylaError) {
    showMessage(err.message);
    return;
  }

  throw err;
}
```

Exported error classes:

- `LaylaError`
- `LaylaAbortError`
- `LaylaBridgeUnavailableError`

## Exported Values

Runtime exports:

- default export: `LaylaSDK`
- `LaylaSDK`
- `Layla`
- `ChatCompletionStream`
- `Images`
- `LaylaError`
- `LaylaAbortError`
- `LaylaBridgeUnavailableError`

## Exported Types

Useful public types:

- `LaylaSDKOptions`
- `RequestOptions`
- `LaylaChatRole`
- `LaylaChatMessage`
- `LaylaCharacter`
- `TavernCardV2`
- `TavernCharacterBook`
- `ChatCompletion`
- `ChatCompletionChunk`
- `ChatCompletionCreateParamsBase`
- `ChatCompletionCreateParamsNonStreaming`
- `ChatCompletionCreateParamsStreaming`

Native bridge protocol types are also exported for apps that need to type lower-level host integration:

- `LaylaApiSendMessage`
- `LaylaApiGetCharacters`
- `LaylaApiGetCharacterImage`
- `LaylaApiGenerateImage`
- `LaylaApiCancel`
- `LaylaApiRequest`
- `LaylaApiEvent`
- `LaylaApiEvent_onMsg`
- `LaylaApiEvent_onMsgEnd`
- `LaylaApiEvent_onError`
- `LaylaApiEvent_onGetCharactersResponse`
- `LaylaApiEvent_onGetCharacterImageResponse`
- `LaylaApiEvent_onGenerateImageResponse`

Prefer the high-level client methods unless a task explicitly requires bridge protocol typing.

## Practical Patterns

Create one client and reuse it:

```ts
const layla = new LaylaSDK();
```

Keep chat history yourself:

```ts
const nextMessages: LaylaChatMessage[] = [
  ...messages,
  { role: 'user', content: input },
];
```

Render streaming responses by replacing the pending assistant message with the stream snapshot:

```ts
stream.on('content', (_delta, snapshot) => {
  setMessages([
    ...nextMessages,
    { role: 'assistant', content: snapshot },
  ]);
});
```

Load Layla characters with a fallback when running outside a fully available host:

```ts
try {
  const laylaCharacters = await layla.characters.list({ signal });
  const hydrated = await Promise.all(
    laylaCharacters.map(async (character) => ({
      character,
      imageSrc: await layla.characters.getImage(character.id, { signal }),
    })),
  );
} catch (err) {
  if (err instanceof LaylaError) {
    useFallbackCharacters();
  } else {
    throw err;
  }
}
```

Use returned image strings directly in `<img src={imageSrc}>`; do not add another `data:` prefix.
