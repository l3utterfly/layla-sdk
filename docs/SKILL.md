---
name: layla-sdk
description: Use the @layla-network/sdk package in third-party Layla mini-apps and WebView apps. Covers stable usage patterns for the Layla client, chat streaming, one-shot resources, abort handling, errors, image data, character cards, and how to read the SDK TypeScript source files as the authoritative API surface when new protocol/resource APIs are added.
---

# Layla SDK

Use `@layla-network/sdk` when building a third-party Layla mini-app that runs inside the Layla WebView and needs to call the on-device Layla host.

This skill intentionally does not duplicate the full API reference. Treat the TypeScript source as the source of truth for current method names, parameters, return types, exported values, and native bridge protocol types.

## Source Map

Before using a specific endpoint, inspect the relevant source file:

- `../src/index.ts`: public package barrel. Import only exports that appear here.
- `../src/client.ts`: top-level `LaylaSDK` client and resource fields such as `chat`, `characters`, and `images`.
- `../src/resources/chat/index.ts`: `layla.chat.completions.create(...)` and `.stream(...)`.
- `../src/resources/chat/types.ts`: OpenAI-shaped chat request/result types.
- `../src/resources/chat/stream.ts`: `ChatCompletionStream` events, async iteration, final result helpers, and abort behavior.
- `../src/resources/characters.ts`: character resource methods such as listing, image lookup, and updates.
- `../src/resources/images.ts`: image generation method, progress callback shape, and result shape.
- `../src/protocol.ts`: native bridge commands/events and shared data types such as `LaylaChatMessage`, `LaylaCharacter`, and `TavernCardV2`.
- `../examples/*/src`: practical app usage patterns.

When the source and this skill disagree, follow the source.

## Runtime

Run SDK calls inside the Layla WebView. The host injects `window.ReactNativeWebView.postMessage`; if that bridge is unavailable, SDK requests reject with `LaylaBridgeUnavailableError`.

Do not use this SDK as an ordinary browser HTTP client. There is no API key, base URL, or fetch endpoint to configure. The SDK sends bridge messages to the Layla host.

## Imports

Import from the package root:

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

`LaylaSDK`, `Layla`, and the default export are aliases for the same client class. Prefer one client instance and reuse it:

```ts
const layla = new LaylaSDK();
```

If a project avoids default imports:

```ts
import { LaylaSDK } from '@layla-network/sdk';
```

## API Discovery

Use high-level client resources first:

```ts
const layla = new LaylaSDK();

await layla.characters.list();
await layla.characters.getImage(characterId);
await layla.characters.update(character);
await layla.images.generateImage(prompt, onProgress);
await layla.chat.completions.create({ messages });
```

For current signatures, open the resource file and read the method declaration. Most non-chat resource methods are one-shot requests that return a `Promise<T>` and may accept `RequestOptions` with `signal?: AbortSignal`.

Use `../src/protocol.ts` for data shapes and native bridge command/event names. Use `../src/index.ts` to confirm which protocol types are public package exports.

## Chat

Chat uses an OpenAI-shaped API. Messages use `LaylaChatMessage`:

```ts
const messages: LaylaChatMessage[] = [
  { role: 'system', content: 'You are concise and helpful.' },
  { role: 'user', content: 'Write a tiny haiku about chess.' },
];
```

Allowed roles are `'system'`, `'user'`, and `'assistant'`. `content` is `string | null`; `name` is optional.

Use non-streaming chat when the UI only needs the final answer:

```ts
const completion = await layla.chat.completions.create({ messages });
const text = completion.choices[0]?.message.content ?? '';
```

Use streaming chat when updating UI as tokens arrive:

```ts
const stream = layla.chat.completions.stream({ messages });

stream.on('content', (_delta, snapshot) => {
  setAssistantText(snapshot);
});

stream.on('error', (err) => {
  console.error(err);
});

const finalText = await stream.finalContent();
```

`ChatCompletionStream` is also async iterable:

```ts
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content ?? '';
  append(delta);
}
```

Breaking out of `for await` aborts the request. Inspect `../src/resources/chat/stream.ts` for the complete event/helper surface.

## One-Shot Resources

For resources backed by a single request/response event, prefer the resource method over raw protocol commands.

Pass abort options when the method accepts `RequestOptions`:

```ts
const controller = new AbortController();

try {
  const result = await layla.characters.list(0, 10, {
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof LaylaAbortError) return;
  throw err;
}
```

Character cards use `LaylaCharacter`:

```ts
type LaylaCharacter = {
  id: string;
  data: TavernCardV2;
};
```

`TavernCardV2` follows Character Card V2. Common fields live under `character.data.data`, including `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `tags`, `creator`, `extensions`, and optional `character_book`.

When updating a character, pass the full `LaylaCharacter` expected by the current `characters.update(...)` signature:

```ts
const updatedId = await layla.characters.update({
  id: character.id,
  data: {
    ...character.data,
    data: {
      ...character.data.data,
      description: 'A careful strategist with a dry sense of humor.',
    },
  },
});
```

If the host creates a new character, the returned id may differ from the requested id. To update a character image, put a ready-to-use base64 data URI in `character.data.data.extensions.image` if that field is still supported by `../src/protocol.ts`.

## Images

Image APIs return ready-to-use image source strings when successful. Do not add another `data:` prefix.

```ts
const imageSrc = await layla.images.generateImage(
  'A cozy pixel-art study with warm lamplight',
  (status, step, totalSteps) => {
    setProgress({ status, step, totalSteps });
  },
);

if (imageSrc) imageElement.src = imageSrc;
```

Character images follow the same convention:

```ts
const imageSrc = await layla.characters.getImage(character.id);
if (imageSrc) imageElement.src = imageSrc;
```

## Errors

All SDK-specific errors extend `LaylaError`.

```ts
try {
  const completion = await layla.chat.completions.create({ messages });
} catch (err) {
  if (err instanceof LaylaAbortError) return;

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

## Protocol Types

Use native protocol types only when typing host integration or bridge-level code. For normal mini-app code, prefer high-level client methods.

When adding or using a new endpoint:

1. Read `../src/index.ts` to confirm what users can import.
2. Read the resource file for the public method signature.
3. Read `../src/protocol.ts` for request/response payload shapes.
4. Use examples under `../examples` for UI integration patterns.
5. Add only stable usage guidance to this skill; avoid copying full type definitions that already live in TypeScript.
