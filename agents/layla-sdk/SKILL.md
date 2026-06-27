---
name: layla-sdk
description: Use the @layla-network/sdk package in third-party Layla mini-apps and WebView apps. Covers the public API surface for creating a Layla client, OpenAI-shaped chat completions and streams including reasoning deltas, paginated character listing, chat sessions, session history, message saves, scheduled chat messages, memories, personas, TTS voices and playback, character images, sentiment analysis, image generation progress/results, file saving, abort handling, SDK errors, exported TypeScript types, and runtime expectations inside the Layla WebView.
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
  type LaylaChatHistoryEntry,
  type LaylaScheduledChatMessage,
  type LaylaCharacter,
  type LaylaMemory,
  type LaylaPersona,
  type LaylaTTSVoice,
  type SentimentValues,
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
await layla.classifier.getSentiment('This is a happy message.');
await layla.images.generateImage(prompt, onProgress);
await layla.chat.completions.create({ messages });
await layla.chat.getChatSessions(characterId);
await layla.chat.getChatHistory(sessionId);
await layla.chat.saveChatMessage(message);
await layla.chat.scheduleChatMessage(scheduledMessage);
await layla.chat.getScheduledChatMessages();
await layla.chat.cancelScheduledChatMessage(scheduledMessageId);
await layla.memories.list(characterId);
await layla.memories.getTopMemories(characterId);
await layla.memories.createOrUpdate(memories);
await layla.personas.get(characterId);
await layla.tts.getVoices();
await layla.tts.generateVoice(ttsVoiceId, text);
await layla.tts.stopSpeaking();
await layla.utils.saveFile(filename, contentBase64, share);
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

When the host wraps text in `<think>` and `</think>` tags, the SDK strips those
tags from visible content. The text inside the tags streams as
`choices[0].delta.reasoning`, is available through `stream.on('reasoning',
(delta, snapshot) => ...)`, and appears on the final
`choices[0].message.reasoning`. `finalContent()` returns only visible assistant
content.

`ChatCompletionStream` is also async iterable:

```ts
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta.content ?? '';
  const reasoning = chunk.choices[0]?.delta.reasoning ?? '';
  append(content);
  appendReasoning(reasoning);
}
```

Breaking out of `for await` aborts the request.

Use `layla.chat.getChatSessions(characterId, offset?, range?, options?)` to list a character's chat sessions before choosing which transcript to load. The result includes the character id and a newest-first `sessions` array with each session's `session_id`, `last_message_timestamp`, and `last_message_content`.

```ts
const { sessions } = await layla.chat.getChatSessions(character.id);
const latestSessionId = sessions[0]?.session_id;
```

Use `layla.chat.getChatHistory(sessionId, offset?, range?, options?)` to fetch the newest chat messages for a specific session when you need to resume or inspect prior conversation state. The result is a paged array of `LaylaChatHistoryEntry` items in reverse chronological order.

```ts
const history: LaylaChatHistoryEntry[] = latestSessionId
  ? await layla.chat.getChatHistory(latestSessionId)
  : [];
```

The returned history entries are useful when building per-session summaries, transcript views, or follow-up prompts that depend on prior context.

Use `layla.chat.saveChatMessage(message, options?)` to create or update a
message in chat history. Pass a non-positive `id` to create a message, or an
existing positive `id` to update it. The resolved entry contains the ID and
other values returned by the host.

```ts
const saved = await layla.chat.saveChatMessage({
  id: 0,
  role: 'user',
  name: 'alex',
  content: 'Remember this message.',
  character_id: character.id,
  session_id: latestSessionId ?? crypto.randomUUID(),
  timestamp: Date.now(),
});
```

Use `layla.chat.scheduleChatMessage(message, options?)` to create a scheduled
message. Pass a non-positive `id` when creating a scheduled message; the host
returns the assigned id. `session_id` can be `null` when the host should
schedule against the character without a specific existing session.

```ts
const scheduled: LaylaScheduledChatMessage =
  await layla.chat.scheduleChatMessage({
    id: 0,
    character_id: character.id,
    session_id: latestSessionId ?? null,
    timestamp: Date.now() + 60 * 60 * 1000,
    message: 'Check in about this in one hour.',
  });
```

Use `layla.chat.getScheduledChatMessages(options?)` to fetch all scheduled chat
messages. The host protocol returns all scheduled messages in one response, so
filter locally for a character or session when needed.

```ts
const scheduledForCharacter = (await layla.chat.getScheduledChatMessages())
  .filter((entry) => entry.character_id === character.id);
```

Use `layla.chat.cancelScheduledChatMessage(id, options?)` to cancel a scheduled
message. The result includes `id`, `success`, and an optional host `message`.

```ts
const result = await layla.chat.cancelScheduledChatMessage(scheduled.id);
if (!result.success) throw new Error(result.message ?? 'Unable to cancel');
```

## Memories

Use `layla.memories.list(characterId, offset?, range?, options?)` to fetch a
character's newest memories in reverse chronological order. Each memory includes
the `session_id` of the chat session it belongs to. Pass `minTimestamp` or
`maxTimestamp` in the fourth argument to narrow the result.

```ts
const memories: LaylaMemory[] = await layla.memories.list(character.id, 0, 20);
```

Use `layla.memories.getTopMemories(characterId, limit?, options?)` when you
want the host's best-ranked memories for a character. The host determines the
ranking heuristic, and the returned `LaylaMemory[]` is newest first.

```ts
const topMemories = await layla.memories.getTopMemories(character.id, 5);
```

Use `layla.memories.createOrUpdate(memories, options?)` to save memory records.
Pass a non-positive `id` to create a memory, or an existing positive `id` to
update it.

```ts
const savedMemories = await layla.memories.createOrUpdate([
  {
    id: 0,
    character_id: character.id,
    session_id: latestSessionId ?? crypto.randomUUID(),
    rawText: 'Alex prefers concise answers.',
    timestamp: Date.now(),
    summary: 'Prefers concise answers.',
    knowledgeGraphJSON: null,
  },
]);
```

## Characters

Use `layla.characters.list(offset?, range?, options?)` to list available characters. Use `layla.characters.getImage(characterId, options?)` to retrieve a ready-to-use image source string.

When designing mini-apps with character selection, prefer square character icons or portraits. Square assets work best across grid cards, compact lists, and Layla import surfaces.

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

## Personas

Use `layla.personas.get(characterId?, options?)` to fetch the default persona
when `characterId` is omitted or `null`, or a character-specific persona when a
character id is passed.

```ts
const persona: LaylaPersona = await layla.personas.get();
const characterPersona = await layla.personas.get(character.id);
```

The returned persona has `name` and `description` fields.

## Text-To-Speech

Use `layla.tts.getVoices(options?)` to fetch the TTS voices installed in Layla.

```ts
const voices: LaylaTTSVoice[] = await layla.tts.getVoices();
const voice = voices[0];
```

Each voice includes `id`, `type`, `tags`, and `name`.

Use `layla.tts.generateVoice(ttsVoiceId, text, options?)` to ask Layla to
generate and play voice audio on the device. Pass a voice ID to select an
installed voice, or pass `null` to use Layla's global default TTS voice. The
promise resolves after the host emits `on_finished_speaking`, meaning playback
has completed.

```ts
await layla.tts.generateVoice(
  null,
  'This line will use the global default Layla voice.',
);
```

```ts
if (voice) {
  await layla.tts.generateVoice(
    voice.id,
    'This line will be spoken by Layla.',
  );
}
```

Use `layla.tts.stopSpeaking(options?)` to stop any in-progress TTS playback.
The promise resolves after the host emits `on_finished_speaking`.

```ts
await layla.tts.stopSpeaking();
```

## Sentiment

Use `layla.classifier.getSentiment(text, options?)` to score text with Layla's sentiment classifier. The result is a `SentimentValues` object keyed by emotion category.

```ts
const sentiment: SentimentValues = await layla.classifier.getSentiment(
  'I am thrilled to start this new project.',
);
```

This is useful for moderation, tone detection, UI reactions, or any feature that needs a lightweight emotional read on a message.

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

## Utilities

Use `layla.utils.saveFile(filename, contentBase64, share?, options?)` to save
base64-encoded content through the host. Omit the data URI prefix.

```ts
const result = await layla.utils.saveFile(
  'notes.txt',
  btoa('Saved from a Layla mini-app.'),
  true,
);

if (!result.success) {
  throw new Error(result.message ?? 'Unable to save file');
}
```

With the browser mock installed, this stores the content in browser
`localStorage`. Passing `share: true` also downloads the content as a `Blob`.

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

When distributing a mini-app as a zip, `app.json`, `index.html` or `index.url`, and referenced assets must be at the root of the zip file. Do not wrap them in an extra parent folder.

Use `index.html` for a self-contained local app. Use `index.url` for an externally hosted app.

## Compatibility Guidance

Prefer stable public APIs from the package root. Avoid relying on private paths inside `@layla-network/sdk`.

When the user asks for a new SDK capability that is not in the bundled reference, check the installed package version and public release source if available. If the Layla host protocol would also need to change, explain that SDK and host changes must stay synchronized.
