---
name: layla-sdk
description: Use the @layla-network/sdk package in third-party Layla mini-apps and WebView apps. Covers the public API surface for creating a Layla client, contextual character-chat execution state and events, OpenAI-shaped chat completions and streams including reasoning deltas, inference engine selection, paginated character listing, chat sessions, session history, message saves, scheduled chat messages, memories, personas, TTS voices, playback and audio-file generation, speech-to-text microphone input and events, background audio controls and events, character images, sentiment analysis, image generation progress/results, private per-mini-app sqlite database queries, file saving, abort handling, SDK errors, exported TypeScript types, and runtime expectations inside the Layla WebView.
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

Layla SDK is designed to work with local LLMs running on device, so response
times can be slow. When building mini-apps, prioritize streaming APIs and show
appropriate loading, thinking, and progress states instead of leaving the UI
idle while a request runs.

For local browser development outside Layla, use `installLaylaMock(...)` before the first SDK call when the app needs SDK responses during development.

## Core Import

Import from the package root:

```ts
import LaylaSDK, {
  Layla,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
  type ChatCompletionMessageParam,
  type LaylaChatMessage,
  type LaylaChatHistoryEntry,
  type LaylaScheduledChatMessage,
  type LaylaCharacter,
  type LaylaMemory,
  type LaylaPersona,
  type LaylaTTSVoice,
  type GenerateVoiceToFileResult,
  type ExecuteSqlResult,
  type STTSpeechRecognizedListener,
  type BackgroundAudioStatusListener,
  type BackgroundAudioTrackChangedListener,
  type BackgroundAudioFinishedListener,
  type LaylaExecutionContext,
  type ChatContextFinishedSpeakingListener,
  type ChatContextNewMessageListener,
  type ChatContextSentimentUpdateListener,
  type ChatContextStartedSpeakingListener,
  type ChatContextStartedThinkingListener,
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
await layla.contextual.getExecutionContext();
await layla.chat.completions.create({ messages });
await layla.chat.getInferenceEngines();
await layla.chat.setInferenceEngine(engineName);
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
await layla.tts.generateVoiceToFile(ttsVoiceId, text, save);
await layla.tts.stopSpeaking();
await layla.stt.startListening();
layla.stt.on('speechRecognized', ({ transcript }) => {});
await layla.stt.stopListening();
await layla.backgroundAudio.start(audioFiles, metadata);
await layla.backgroundAudio.pause();
await layla.backgroundAudio.resume();
await layla.backgroundAudio.skip();
await layla.backgroundAudio.stop();
await layla.db.executeSql(query, params);
await layla.utils.saveFile(filename, contentBase64, share);
```

Read `references/sdk-api.md` before using a method signature that is not shown here.

## Contextual Mini-Apps

Use `layla.contextual.getExecutionContext(options?)` to get the current character
and session along with the current Layla `app_version`. The context object is
always returned; its `character` and `session_id` fields are `null` when
standalone. Contextual mini-apps can subscribe to new messages, sentiment
updates, and character speaking or thinking state in the surrounding chat.

```ts
const context: LaylaExecutionContext = await layla.contextual.getExecutionContext();
console.log(context.app_version);
const onNewMessage: ChatContextNewMessageListener = ({ message }) => {
  console.log(message.role, message.content);
};
const onSentiment: ChatContextSentimentUpdateListener = ({ sentiment }) => {
  console.log(sentiment);
};
const onStartedSpeaking: ChatContextStartedSpeakingListener = () => {
  console.log('speaking');
};
const onFinishedSpeaking: ChatContextFinishedSpeakingListener = () => {
  console.log('finished speaking');
};
const onStartedThinking: ChatContextStartedThinkingListener = () => {
  console.log('thinking');
};

layla.contextual.on('chatContextNewMessage', onNewMessage);
layla.contextual.on('chatContextSentimentUpdate', onSentiment);
layla.contextual.on('chatContextStartedSpeaking', onStartedSpeaking);
layla.contextual.on('chatContextFinishedSpeaking', onFinishedSpeaking);
layla.contextual.on('chatContextStartedThinking', onStartedThinking);

layla.contextual.off('chatContextNewMessage', onNewMessage);
layla.contextual.off('chatContextSentimentUpdate', onSentiment);
layla.contextual.off('chatContextStartedSpeaking', onStartedSpeaking);
layla.contextual.off('chatContextFinishedSpeaking', onFinishedSpeaking);
layla.contextual.off('chatContextStartedThinking', onStartedThinking);
```

The host uses `on_finished_speaking` for both contextual speech completion and
TTS playback completion, so treat `chatContextFinishedSpeaking` as a shared
speech-finished signal rather than a source-specific event.

For local testing, set `executionContext` (including `app_version`) in
`installLaylaMock(...)`, or omit it to use a standalone mock context. Drive
events with the returned handle's `emitChatContextNewMessage(...)`,
`emitChatContextSentimentUpdate(...)`, `emitChatContextStartedSpeaking()`,
`emitChatContextFinishedSpeaking()`, and `emitChatContextStartedThinking()`.
Read `references/sdk-api.md` for full payloads, mock examples, and abort handling.

## Chat

Chat uses an OpenAI-shaped API. Completion inputs use
`ChatCompletionMessageParam`:

```ts
const messages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'You are concise and helpful.' },
  { role: 'user', content: 'Write a tiny haiku about chess.' },
];
```

Send images using OpenAI Chat Completions content parts. The image URL must be
a base64 data URL because the SDK translates it to Layla's native
`image_base64` wire field:

```ts
const messages: ChatCompletionMessageParam[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${base64Image}`,
          detail: 'auto',
        },
      },
    ],
  },
];
```

Layla supports one image per message. Remote image URLs and multiple image
parts are rejected because the native protocol accepts one base64 image. The
OpenAI `detail` field is accepted but has no Layla wire equivalent.

Use non-streaming chat when the UI only needs the final answer:

```ts
const completion = await layla.chat.completions.create({ messages });
const text = completion.choices[0]?.message.content ?? '';
```

Prefer streaming chat for user-facing mini-app flows so the UI can update as
tokens arrive, especially when on-device local LLM responses take time:

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

Use `layla.chat.getInferenceEngines(options?)` to list the inference engines
available for subsequent chat completions. Select one with
`layla.chat.setInferenceEngine(engineName, options?)`, or pass `null` to reset
to the host's default engine.

```ts
const engines = await layla.chat.getInferenceEngines();
const selection = await layla.chat.setInferenceEngine(engines[0] ?? null);

if (!selection.success) {
  throw new Error('The requested inference engine is unavailable.');
}
```

The setter resolves with `success` and `engineName`. If a requested name is not
available, the host returns `success: false` and resets to its default engine.

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

Use `layla.tts.generateVoiceToFile(ttsVoiceId, text, save?, options?)` to
generate audio without playing it. Pass `null` for the global default voice.
When `save` is omitted or false, `audio_data_base64` contains a ready-to-use
audio data URI. When `save` is true, the host saves the audio in the mini-app's
private files and returns its `filename` instead.

```ts
const generated: GenerateVoiceToFileResult =
  await layla.tts.generateVoiceToFile(
    voice?.id ?? null,
    'Generate this line without playing it.',
  );

if (generated.success && generated.audio_data_base64) {
  audioElement.src = generated.audio_data_base64;
}

const saved = await layla.tts.generateVoiceToFile(
  voice?.id ?? null,
  'Save this generated line.',
  true,
);
console.log(saved.filename);
```

## Speech-To-Text

Use the `layla.stt` surface for microphone speech input. It has three parts: a
`startListening(options?)` request, a `speechRecognized` event, and a
`stopListening(options?)` request.

`layla.stt.startListening(options?)` asks the host to start capturing microphone
audio. Its promise resolves once the host emits `on_stt_listening_started`,
confirming the recogniser started, or rejects on error/abort. Recognised speech
is not returned by this call — subscribe to the `speechRecognized` event to
receive transcripts. Subscribe before (or right after) starting so no transcript
is missed.

```ts
const onSpeech: STTSpeechRecognizedListener = ({ transcript }) => {
  console.log('Heard:', transcript);
};

layla.stt.on('speechRecognized', onSpeech);

await layla.stt.startListening();

// Release the microphone when input is no longer needed. Resolves once the
// host emits `on_stt_listening_stopped`.
await layla.stt.stopListening();

// Stop receiving transcripts when microphone input is no longer needed.
layla.stt.off('speechRecognized', onSpeech);
```

`stopListening()` stops the host recogniser; it does not remove your
`speechRecognized` subscription — use `off('speechRecognized', ...)` for that.

The resource attaches its window `message` listener only while it has
subscribers and detaches it after the last `off(...)`. The browser mock confirms
listening, then emits one canned `speechRecognized` event shortly after
`startListening()` succeeds; configure that phrase with the `sttTranscript`
option (set it to `null` to disable), and drive additional recognised-speech
events with the returned handle's `emitSTTSpeechRecognized(...)`. It also
confirms `stopListening()` with `on_stt_listening_stopped`.

## Background Audio

Use the separate `layla.backgroundAudio` surface for background music,
podcasts, and other queued audio. `start(audioFiles, metadata?)` replaces any
existing queue. Local file paths resolve from the mini-app root. Metadata is
optional; `artworkUrl`, when present, must be a remote HTTPS URL.

```ts
await layla.backgroundAudio.start(['intro.mp3', 'chapter-1.mp3'], {
  title: 'A quiet journey',
  artist: 'Layla Mini-App',
  artworkUrl: 'https://example.com/artwork.jpg',
});

await layla.backgroundAudio.pause();
await layla.backgroundAudio.resume();
await layla.backgroundAudio.skip();
await layla.backgroundAudio.skip(0);
await layla.backgroundAudio.stop();
```

These controls are fire-and-forget in the host protocol. Their promises resolve
once the command is posted, so use events for player state. `pause()` retains
the queue and position; `stop()` clears and releases the player.

```ts
const onTrackChanged: BackgroundAudioTrackChangedListener = (event) => {
  console.log(event.previousIndex, event.currentIndex);
};
const onStatus: BackgroundAudioStatusListener = (status) => {
  console.log(status.playing, status.currentTime, status.duration);
};
const onFinished: BackgroundAudioFinishedListener = () => {
  console.log('queue finished');
};

layla.backgroundAudio.on('trackChanged', onTrackChanged);
layla.backgroundAudio.on('status', onStatus);
layla.backgroundAudio.on('finished', onFinished);

layla.backgroundAudio.off('trackChanged', onTrackChanged);
layla.backgroundAudio.off('status', onStatus);
layla.backgroundAudio.off('finished', onFinished);
```

The host may throttle or suspend periodic status events while the app is
backgrounded, so do not use them to drive queue logic. The browser mock updates
status for player commands and exposes `emitBackgroundAudioTrackChanged(...)`,
`emitBackgroundAudioStatus(...)`, and `emitBackgroundAudioFinished()` for local
event testing. Its `generateVoiceToFile(...)` returns a small mock WAV data URI
or saves `mock-voice.wav` when `save` is true.

## Database

Use `layla.db.executeSql(query, params?, options?)` to run SQL against a private
sqlite database. Each mini-app gets its own database; it is not shared with the
Layla app or with other mini-apps, so it is the place to persist structured
mini-app state (settings, saved records, caches).

Use `?` placeholders and pass their values in `params` so the host binds them
safely instead of interpolating untrusted values into the SQL string.

```ts
await layla.db.executeSql(
  'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)',
);

const insert = await layla.db.executeSql(
  'INSERT INTO notes (body) VALUES (?)',
  ['Remember to water the plants.'],
);
console.log(insert.insertId, insert.rowsAffected);

const read: ExecuteSqlResult = await layla.db.executeSql(
  'SELECT id, body FROM notes WHERE body LIKE ?',
  ['%plants%'],
);
for (const row of read.rows) {
  console.log(row.id, row.body);
}
```

The result has `rows` (rows returned by a read; empty for writes),
`rowsAffected` (rows changed by an INSERT/UPDATE/DELETE), and `insertId` (row id
of the last inserted row, 0 when not applicable).

For local testing, the browser mock has no real sqlite. By default every query
resolves to an empty result (`{ rows: [], rowsAffected: 0, insertId: 0 }`); pass
an `executeSql` handler to `installLaylaMock(...)` to return your own results, or
to back the mock with an in-browser SQL engine.

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

List the image models the host currently has available with
`layla.images.getImageGenerationModels()`, then pass a model's `id` as the
`modelId` argument (4th) to generate with it. When `modelId` is omitted the host
uses its default model:

```ts
const models = await layla.images.getImageGenerationModels();

const imageSrc = await layla.images.generateImage(
  'A cozy pixel-art study with warm lamplight',
  (status, step, totalSteps) => setProgress({ status, step, totalSteps }),
  undefined, // img2img_base64
  models[0]?.id, // modelId — omit to use the host default
);
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
