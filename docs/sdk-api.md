# SDK API

Install the Layla SDK from npm:

```bash
npm install @layla-network/sdk
```

Import the SDK from the package root:

```ts
import LaylaSDK, {
  Layla,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
  installLaylaMock,
  makeMockCharacter,
  type LaylaChatMessage,
  type LaylaChatHistoryEntry,
  type LaylaMemory,
  type LaylaApiSaveChatMessage,
  type LaylaApiSaveFile,
  type LaylaApiGetMemories,
  type LaylaApiCreateOrUpdateMemories,
  type LaylaApiEvent_onGetChatSessionsResponse,
  type LaylaApiEvent_onSaveChatMessageResponse,
  type LaylaApiEvent_onGetMemoriesResponse,
  type LaylaApiEvent_onCreateOrUpdateMemoriesResponse,
  type LaylaApiEvent_onSaveFileResponse,
  type LaylaCharacter,
  type MemoryListOptions,
  type SaveFileResult,
  type SentimentValues,
  type TavernCardV2,
} from '@layla-network/sdk';
```

`LaylaSDK`, `Layla`, and the default export are aliases for the same client class. Most apps should create one client and reuse it.

```ts
const layla = new LaylaSDK();
```

The SDK must run inside the Layla WebView for real host calls. It does not use an API key, base URL, or HTTP endpoint. Instead, it wraps the WebView bridge between the mini-app and the Layla React Native host.

## `new LaylaSDK(options?)`

Creates the SDK client.

```ts
import { LaylaSDK } from '@layla-network/sdk';

const layla = new LaylaSDK();
```

The constructor accepts an optional `LaylaSDKOptions` object.

```ts
const layla = new LaylaSDK({
  model: 'layla',
});
```

`model` is reserved for compatibility and future use. The Layla host chooses the actual model.

## `layla.chat.completions.create(...)`

Creates a chat completion. Use this when you only need the final assistant message.

```ts
import { LaylaSDK, type LaylaChatMessage } from '@layla-network/sdk';

const layla = new LaylaSDK();

const messages: LaylaChatMessage[] = [
  { role: 'system', content: 'You are concise and helpful.' },
  { role: 'user', content: 'Give me one chess tip.' },
];

const completion = await layla.chat.completions.create({
  messages,
});

const text = completion.choices[0]?.message.content ?? '';
```

You may pass `model` for OpenAI-shaped compatibility.

```ts
await layla.chat.completions.create({
  model: 'layla',
  messages,
});
```

## `layla.chat.completions.stream(...)`

Starts a streaming chat completion and returns a `ChatCompletionStream` immediately. Use this for UI that updates while Layla is generating.

```ts
const stream = layla.chat.completions.stream({
  messages: [
    { role: 'user', content: 'Tell me a short story.' },
  ],
});

stream.on('content', (_delta, snapshot) => {
  setAssistantText(snapshot);
});

stream.on('end', () => {
  setBusy(false);
});

stream.on('error', (error) => {
  showError(error.message);
  setBusy(false);
});

const finalText = await stream.finalContent();
```

You can also stream with async iteration:

```ts
const stream = layla.chat.completions.stream({ messages });

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content ?? '';
  appendToAssistantMessage(delta);
}
```

Breaking out of the `for await` loop aborts the stream.

## `layla.chat.completions.create({ stream: true, ... })`

Returns a streaming completion using the OpenAI-style `stream: true` option.

```ts
const stream = await layla.chat.completions.create({
  messages,
  stream: true,
});

stream.on('content', (_delta, snapshot) => {
  setAssistantText(snapshot);
});
```

## `ChatCompletionStream`

The stream object supports event listeners, async iteration, final result helpers, and abort.

```ts
const stream = layla.chat.completions.stream({ messages });

const logContent = (delta: string, snapshot: string) => {
  console.log(delta, snapshot);
};

stream.on('chunk', (chunk) => {
  console.log(chunk.choices[0]?.delta.content ?? '');
});

stream.on('content', logContent);

stream.off('content', logContent);

const fullText = await stream.finalContent();
const completion = await stream.finalChatCompletion();
```

Abort an active stream from a stop button:

```ts
const stream = layla.chat.completions.stream({ messages });

stopButton.onclick = () => {
  stream.abort();
};
```

## `layla.characters.list(offset?, range?, options?)`

Lists available Layla characters. `offset` defaults to `0`, and `range` defaults to `10`.

```ts
const characters = await layla.characters.list();

for (const character of characters) {
  console.log(character.id, character.data.data.name);
}
```

Request a specific page:

```ts
const pageSize = 10;
const page = 2;

const characters = await layla.characters.list(page * pageSize, pageSize);
```

Pass an abort signal as the third argument:

```ts
const controller = new AbortController();

const characters = await layla.characters.list(0, 10, {
  signal: controller.signal,
});
```

## `layla.characters.getImage(characterId, options?)`

Gets a character portrait. The returned value is a ready-to-use image source string, or `null` if no image is available.

```ts
const characters = await layla.characters.list(0, 1);
const character = characters[0];

const imageSrc = await layla.characters.getImage(character.id);

if (imageSrc) {
  imageElement.src = imageSrc;
}
```

## `layla.chat.getChatSessions(characterId, offset?, range?, options?)`

Fetches a character's chat sessions. Results come back as an object containing the `character_id` and a `sessions` array in reverse chronological order.

```ts
const { sessions } = await layla.chat.getChatSessions(character.id);

for (const session of sessions) {
  console.log(
    session.session_id,
    session.last_message_timestamp,
    session.last_message_content,
  );
}
```

Use `offset` and `range` when you need to page through a longer session list. Pass an abort signal as the fourth argument.

```ts
const sessionsPage = await layla.chat.getChatSessions(character.id, 10, 10, {
  signal: controller.signal,
});
```

## `layla.chat.getChatHistory(sessionId, offset?, range?, options?)`

Fetches the newest chat messages for a specific chat session. Results come back as a paged array of `LaylaChatHistoryEntry` items in reverse chronological order.

```ts
const { sessions } = await layla.chat.getChatSessions(character.id, 0, 1);
const sessionId = sessions[0]?.session_id;
const history = sessionId
  ? await layla.chat.getChatHistory(sessionId)
  : [];

for (const entry of history) {
  console.log(entry.role, entry.content);
}
```

Use `offset` and `range` when you need to page through a longer transcript. Pass an abort signal as the fourth argument.

```ts
const historyPage = await layla.chat.getChatHistory(sessionId, 20, 10, {
  signal: controller.signal,
});
```

## `layla.chat.saveChatMessage(message, options?)`

Creates or updates a message in chat history and returns the saved
`LaylaChatHistoryEntry`. Pass `id: 0` (or another non-positive value) to create
a message. Pass an existing positive `id` to update it.

```ts
const saved = await layla.chat.saveChatMessage({
  id: 0,
  role: 'user',
  name: 'alex',
  content: 'Remember this message.',
  character_id: character.id,
  session_id: sessionId,
  timestamp: Date.now(),
});

console.log(saved.id);
```

Pass an abort signal as the second argument:

```ts
const saved = await layla.chat.saveChatMessage(message, {
  signal: controller.signal,
});
```

## `layla.memories.list(characterId, offset?, range?, options?)`

Fetches the newest memories for a specific character. Results come back as a paged array of `LaylaMemory` items in reverse chronological order.

```ts
const memories = await layla.memories.list(character.id);

for (const memory of memories) {
  console.log(memory.rawText, memory.summary);
}
```

Use `offset` and `range` when you need to page through a longer memory list. Pass `minTimestamp`, `maxTimestamp`, or an abort signal in the fourth argument.

```ts
const recentMemories = await layla.memories.list(character.id, 0, 20, {
  minTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
  signal: controller.signal,
});
```

## `layla.memories.createOrUpdate(memories, options?)`

Creates or updates memories and returns the saved `LaylaMemory` entries. Pass `id: 0` (or another non-positive value) to create a memory. Pass an existing positive `id` to update it.

```ts
const savedMemories = await layla.memories.createOrUpdate([
  {
    id: 0,
    character_id: character.id,
    rawText: 'Alex prefers concise answers.',
    timestamp: Date.now(),
    summary: 'Prefers concise answers.',
    knowledgeGraphJSON: null,
  },
]);

console.log(savedMemories[0]?.id);
```

Pass an abort signal as the second argument:

```ts
const savedMemories = await layla.memories.createOrUpdate(memories, {
  signal: controller.signal,
});
```

## `layla.classifier.getSentiment(text, options?)`

Scores a piece of text with Layla's sentiment classifier and returns `SentimentValues`, keyed by emotion category.

```ts
const sentiment = await layla.classifier.getSentiment(
  'I am thrilled to start this new project.',
);

console.log(sentiment);
```

## `layla.characters.update(character, options?)`

Updates a Layla character and resolves with the updated character id. If the host creates a new character, the returned id may differ from the id you passed in.

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

To include an image when updating a character, store a base64-encoded image URI in `character.data.data.extensions.image`. Include the data URI prefix, such as `data:image/png;base64,`.

```ts
const updatedId = await layla.characters.update({
  id: 'new-character',
  data: {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Mira',
      description: 'A warm sci-fi guide.',
      personality: 'curious, kind',
      scenario: '',
      first_mes: "Hi, I'm Mira.",
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['sci-fi'],
      creator: 'My Mini-App',
      character_version: '1.0',
      extensions: {
        image: imageSrc,
      },
    },
  },
});
```

## `layla.images.generateImage(prompt, onProgress, options?)`

Generates an image from a prompt. Progress updates are reported through the callback. The returned value is a ready-to-use image source string, or `null` if the host does not return an image.

```ts
const imageSrc = await layla.images.generateImage(
  'A cozy pixel-art study with warm lamplight',
  (status, step, totalSteps) => {
    setProgress({
      status,
      step,
      totalSteps,
    });
  },
);

if (imageSrc) {
  previewImage.src = imageSrc;
}
```

Use an abort signal when the UI can cancel image generation:

```ts
const controller = new AbortController();

const imagePromise = layla.images.generateImage(
  prompt,
  onProgress,
  { signal: controller.signal },
);

controller.abort();

try {
  await imagePromise;
} catch (error) {
  if (error instanceof LaylaAbortError) {
    return;
  }

  throw error;
}
```

## `layla.utils.saveFile(filename, contentBase64, share?, options?)`

Saves raw base64-encoded content as a file. Do not include a data URI prefix.
Set `share` to `true` to ask the native host to open its share sheet after
saving. It defaults to `false`.

```ts
const contentBase64 = btoa('Hello from Layla.');
const result = await layla.utils.saveFile(
  'hello.txt',
  contentBase64,
  true,
);

if (!result.success) {
  throw new Error(result.message ?? 'Unable to save file');
}
```

The browser mock downloads the content as a `Blob`. Browsers cannot reproduce
the native share sheet, so `share: true` still performs a regular download.

Pass an abort signal as the fourth argument:

```ts
await layla.utils.saveFile('hello.txt', contentBase64, false, {
  signal: controller.signal,
});
```

## Abort Signals

Chat, character requests, classifier requests, and image generation can be cancelled from the mini-app.

```ts
const controller = new AbortController();

try {
  const completion = await layla.chat.completions.create({
    messages,
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof LaylaAbortError) {
    return;
  }

  throw error;
}
```

For streaming chat, either pass a signal or call `stream.abort()`.

```ts
const controller = new AbortController();

const stream = layla.chat.completions.stream({
  messages,
  signal: controller.signal,
});

controller.abort();
```

## Errors

SDK-specific errors extend `LaylaError`.

```ts
import {
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
} from '@layla-network/sdk';

try {
  const completion = await layla.chat.completions.create({ messages });
} catch (error) {
  if (error instanceof LaylaAbortError) {
    return;
  }

  if (error instanceof LaylaBridgeUnavailableError) {
    showError('Open this mini-app inside Layla.');
    return;
  }

  if (error instanceof LaylaError) {
    showError(error.message);
    return;
  }

  throw error;
}
```

Exported error classes:

- `LaylaError`
- `LaylaAbortError`
- `LaylaBridgeUnavailableError`

## `installLaylaMock(options?)`

Installs a mock Layla host for local development outside the Layla WebView. Install it before the first SDK call.

```ts
import { installLaylaMock } from '@layla-network/sdk';

if (import.meta.env.DEV) {
  installLaylaMock({
    debug: true,
  });
}
```

Customize mock chat responses:

```ts
installLaylaMock({
  respond: (messages) => {
    const last = messages.at(-1)?.content ?? '';
    return `Mock response to: ${last}`;
  },
});
```

Customize mock session history with static transcript data:

```ts
installLaylaMock({
  chatHistory: [
    {
      role: 'assistant',
      name: 'Aria',
      character_id: 'mock-aria',
      session_id: 'mock-aria-session-1',
      content: 'I saved the last idea we talked about.',
      timestamp: Date.now(),
    },
  ],
});

const { sessions } = await layla.chat.getChatSessions('mock-aria');
const history = sessions[0]
  ? await layla.chat.getChatHistory(sessions[0].session_id)
  : [];
```

When `chatHistory` is omitted, the mock supplies multiple sessions per default character so local apps can exercise the same session-first flow.

Customize mock memories with static memory data:

```ts
installLaylaMock({
  memories: [
    {
      id: 1,
      character_id: 'mock-aria',
      rawText: 'Aria remembers that Alex likes quiet mornings.',
      timestamp: Date.now(),
      summary: 'Alex likes quiet mornings.',
      knowledgeGraphJSON: null,
    },
  ],
});

const memories = await layla.memories.list('mock-aria');
```

When `memories` is omitted, the mock supplies a small memory set per default character.

The returned handle can uninstall the mock.

```ts
const mock = installLaylaMock();

mock.uninstall();
```

## `makeMockCharacter(name, overrides?)`

Creates a valid mock character card for use with `installLaylaMock`.

```ts
import { installLaylaMock, makeMockCharacter } from '@layla-network/sdk';

installLaylaMock({
  characters: [
    makeMockCharacter('Aria'),
    makeMockCharacter('Kai', {
      tags: ['demo'],
      personality: 'playful, direct',
    }),
  ],
});
```

## Public Types

Useful exported types include:

- `LaylaSDKOptions`
- `RequestOptions`
- `LaylaChatRole`
- `LaylaChatMessage`
- `LaylaChatHistoryEntry`
- `LaylaMemory`
- `MemoryListOptions`
- `LaylaApiEvent_onGetChatSessionsResponse`
- `LaylaApiSaveChatMessage`
- `LaylaApiEvent_onSaveChatMessageResponse`
- `LaylaApiGetMemories`
- `LaylaApiCreateOrUpdateMemories`
- `LaylaApiEvent_onGetMemoriesResponse`
- `LaylaApiEvent_onCreateOrUpdateMemoriesResponse`
- `LaylaApiSaveFile`
- `LaylaApiEvent_onSaveFileResponse`
- `SaveFileResult`
- `LaylaCharacter`
- `TavernCardV2`
- `SentimentValues`
- `TavernCharacterBook`
- `ChatCompletion`
- `ChatCompletionChunk`
- `ChatCompletionCreateParamsBase`
- `ChatCompletionCreateParamsNonStreaming`
- `ChatCompletionCreateParamsStreaming`

Protocol types are also exported for host integration and advanced typing, but ordinary mini-apps should prefer the high-level SDK methods above.

## Source of Truth

The TypeScript source is the source of truth for current signatures:

- `src/index.ts`
- `src/client.ts`
- `src/resources/chat/index.ts`
- `src/resources/chat/stream.ts`
- `src/resources/characters.ts`
- `src/resources/classifier.ts`
- `src/resources/images.ts`
- `src/resources/memories.ts`
- `src/resources/utils.ts`
- `src/protocol.ts`
- `src/errors.ts`
- `src/mock.ts`
