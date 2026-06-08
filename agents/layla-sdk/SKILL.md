---
name: layla-sdk
description: Use the @layla-network/sdk package in third-party Layla mini-apps and WebView apps. Covers the public API surface for creating a Layla client, OpenAI-shaped chat completions and streams, paginated character listing and character images, image generation progress/results, abort handling, SDK errors, exported TypeScript types, and runtime expectations inside the Layla WebView.
---

# Layla SDK

Use `@layla-network/sdk` when building a third-party Layla mini-app that runs inside the Layla WebView and needs to call the on-device Layla host.

The packaged skill is self-contained. Use the bundled references first:

- Read `references/sdk-api.md` for SDK imports, method signatures, examples, exported types, mock usage, abort behavior, and error handling.
- Read `references/mini-apps-overview.md` for mini-app packaging, metadata, `index.html` versus `index.url`, WebView runtime expectations, and troubleshooting.

If the bundled reference appears stale and internet access is available, check the public package source or release docs for the installed package version:

- `https://github.com/l3utterfly/layla-sdk`
- Prefer tagged release source over the default branch when the user's project has a specific installed version.

## Runtime Rules

Run SDK calls inside the Layla WebView. The host injects the React Native WebView bridge. If that bridge is unavailable, SDK requests reject with `LaylaBridgeUnavailableError`.

Do not use this SDK as an ordinary browser HTTP client. There is no API key, base URL, or fetch endpoint to configure. The SDK sends bridge messages to the Layla host.

For local browser development outside Layla, use `installLaylaMock(...)` before the first SDK call when the app needs SDK responses during development.

## Core Import

Import from the package root:

```ts
import LaylaSDK, {
  Layla,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
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

## Common APIs

Use high-level client resources first:

```ts
const layla = new LaylaSDK();

await layla.characters.list();
await layla.characters.getImage(characterId);
await layla.characters.update(character);
await layla.images.generateImage(prompt, onProgress);
await layla.chat.completions.create({ messages });
```

Read `references/sdk-api.md` before using a method signature that is not shown here.

## Chat

Chat uses an OpenAI-shaped API. Messages use `LaylaChatMessage`:

```ts
const messages: LaylaChatMessage[] = [
  { role: 'system', content: 'You are concise and helpful.' },
  { role: 'user', content: 'Write a tiny haiku about chess.' },
];
```

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

Breaking out of `for await` aborts the request.

## Characters

Use `layla.characters.list(offset?, range?, options?)` to list available characters. Use `layla.characters.getImage(characterId, options?)` to retrieve a ready-to-use image source string.

Character cards use `LaylaCharacter`:

```ts
type LaylaCharacter = {
  id: string;
  data: TavernCardV2;
};
```

`TavernCardV2` follows Character Card V2. Common fields live under `character.data.data`, including `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `tags`, `creator`, `extensions`, and optional `character_book`.

When updating a character, pass the full `LaylaCharacter` expected by `characters.update(...)`:

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

If the host creates a new character, the returned id may differ from the requested id.

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

## Abort Handling

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

For streaming chat, either pass a signal or call `stream.abort()`.

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

## Mini-App Packaging

Read `references/mini-apps-overview.md` before preparing an app for import into Layla.

At minimum, a packaged mini-app folder should include:

- `app.json`
- `index.html` or `index.url`
- any referenced icons, images, or assets

Use `index.html` for a self-contained local app. Use `index.url` for an externally hosted app.

## Compatibility Guidance

Prefer stable public APIs from the package root. Avoid relying on private paths inside `@layla-network/sdk`.

When the user asks for a new SDK capability that is not in the bundled reference, check the installed package version and public release source if available. If the Layla host protocol would also need to change, explain that SDK and host changes must stay synchronized.
