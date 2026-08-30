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
  type ChatCompletionMessageParam,
  type ChatCompletionContentPart,
  type ChatCompletionContentPartText,
  type ChatCompletionContentPartImage,
  type LaylaChatMessage,
  type LaylaChatHistoryEntry,
  type LaylaScheduledChatMessage,
  type LaylaMemory,
  type LaylaPersona,
  type LaylaTTSVoice,
  type GenerateVoiceToFileResult,
  type BackgroundAudioMetadata,
  type BackgroundAudioStatusListener,
  type BackgroundAudioTrackChangedListener,
  type BackgroundAudioFinishedListener,
  type LaylaExecutionContext,
  type ChatContextFinishedSpeaking,
  type ChatContextFinishedSpeakingListener,
  type ChatContextNewMessage,
  type ChatContextNewMessageListener,
  type ChatContextSentimentUpdate,
  type ChatContextSentimentUpdateListener,
  type ChatContextStartedSpeaking,
  type ChatContextStartedSpeakingListener,
  type ChatContextStartedThinking,
  type ChatContextStartedThinkingListener,
  type LaylaApiSaveChatMessage,
  type LaylaApiScheduledChatMessage,
  type LaylaApiGetScheduledChatMessages,
  type LaylaApiCancelScheduledChatMessage,
  type LaylaApiSaveFile,
  type LaylaApiReadFile,
  type LaylaApiGetMemories,
  type LaylaApiGetTopMemories,
  type LaylaApiCreateOrUpdateMemories,
  type LaylaApiGetPersona,
  type LaylaApiGetTTSVoices,
  type LaylaApiGenerateVoice,
  type LaylaApiGenerateVoiceToFile,
  type LaylaApiStopSpeaking,
  type LaylaApiStartBackgroundAudioPlayer,
  type LaylaApiStopBackgroundAudioPlayer,
  type LaylaApiPauseBackgroundAudioPlayer,
  type LaylaApiResumeBackgroundAudioPlayer,
  type LaylaApiSkipBackgroundAudioTrack,
  type LaylaApiGetInferenceEngines,
  type LaylaApiSetInferenceEngine,
  type LaylaApiGetExecutionContext,
  type LaylaApiEvent_onGetChatSessionsResponse,
  type LaylaApiEvent_onSaveChatMessageResponse,
  type LaylaApiEvent_onScheduledChatMessage,
  type LaylaApiEvent_onGetScheduledChatMessagesResponse,
  type LaylaApiEvent_onCancelScheduledChatMessage,
  type LaylaApiEvent_onGetMemoriesResponse,
  type LaylaApiEvent_onGetTopMemoriesResponse,
  type LaylaApiEvent_onCreateOrUpdateMemoriesResponse,
  type LaylaApiEvent_onGetPersonaResponse,
  type LaylaApiEvent_onGetTTSVoicesResponse,
  type LaylaApiEvent_onGetInferenceEnginesResponse,
  type LaylaApiEvent_onSetInferenceEngineResponse,
  type LaylaApiEvent_onGetExecutionContextResponse,
  type LaylaApiEvent_onChatContextFinishedSpeaking,
  type LaylaApiEvent_onChatContextNewMessage,
  type LaylaApiEvent_onChatContextSentimentUpdate,
  type LaylaApiEvent_onChatContextStartedSpeaking,
  type LaylaApiEvent_onChatContextStartedThinking,
  type LaylaApiEvent_onFinishedSpeaking,
  type LaylaApiEvent_onGenerateVoiceToFileResponse,
  type LaylaApiEvent_onBackgroundAudioTrackChanged,
  type LaylaApiEvent_onBackgroundAudioStatus,
  type LaylaApiEvent_onBackgroundAudioFinished,
  type LaylaApiEvent_onSaveFileResponse,
  type LaylaApiEvent_onReadFileResponse,
  type LaylaCharacter,
  type MemoryListOptions,
  type ReadFileResult,
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

## `layla.contextual.getExecutionContext(options?)`

Returns the context in which the host launched the mini-app. A contextual
mini-app receives the current character and chat session. The context always
includes `app_version`, the version of the Layla app hosting the mini-app. For
a standalone top-level mini-app, `character` and `session_id` are both `null`.

```ts
const context = await layla.contextual.getExecutionContext();

console.log(context.app_version);
console.log(context.character?.data.data.name);
console.log(context.session_id);
```

The character and session fields may each be `null` when that part of the
context is not active. Detect standalone mode by checking both fields. Pass an
abort signal as the first argument:

```ts
const context = await layla.contextual.getExecutionContext({
  signal: controller.signal,
});
```

## `layla.contextual.on('chatContextNewMessage', listener)`

Listens for messages that the host adds to the surrounding character chat.
This pushed event is available only when the mini-app is running in a character
chat context. Its payload includes the message, character ID, session ID, and
timestamp.

```ts
import type { ChatContextNewMessageListener } from '@layla-network/sdk';

const onNewMessage: ChatContextNewMessageListener = ({
  message,
  character_id,
  session_id,
  timestamp,
}) => {
  console.log(message.role, message.content);
  console.log(character_id, session_id, timestamp);
};

layla.contextual.on('chatContextNewMessage', onNewMessage);

// Remove the exact listener when the UI is disposed.
layla.contextual.off('chatContextNewMessage', onNewMessage);
```

## Other contextual chat events

Contextual mini-apps can also react to the surrounding character's sentiment,
speech, and thinking state:

```ts
import type {
  ChatContextFinishedSpeakingListener,
  ChatContextSentimentUpdateListener,
  ChatContextStartedSpeakingListener,
  ChatContextStartedThinkingListener,
} from '@layla-network/sdk';

const onSentimentUpdate: ChatContextSentimentUpdateListener = ({ sentiment }) => {
  setExpression(sentiment);
};
const onStartedSpeaking: ChatContextStartedSpeakingListener = () => {
  setSpeaking(true);
};
const onFinishedSpeaking: ChatContextFinishedSpeakingListener = () => {
  setSpeaking(false);
};
const onStartedThinking: ChatContextStartedThinkingListener = () => {
  setThinking(true);
};

layla.contextual.on('chatContextSentimentUpdate', onSentimentUpdate);
layla.contextual.on('chatContextStartedSpeaking', onStartedSpeaking);
layla.contextual.on('chatContextFinishedSpeaking', onFinishedSpeaking);
layla.contextual.on('chatContextStartedThinking', onStartedThinking);

layla.contextual.off('chatContextSentimentUpdate', onSentimentUpdate);
layla.contextual.off('chatContextStartedSpeaking', onStartedSpeaking);
layla.contextual.off('chatContextFinishedSpeaking', onFinishedSpeaking);
layla.contextual.off('chatContextStartedThinking', onStartedThinking);
```

`chatContextSentimentUpdate` receives `{ sentiment }`, where `sentiment` is a
key of `SentimentValues`. The speaking and thinking lifecycle listeners receive
`null`; listeners that do not need it can declare no parameters, as above.

The host uses the shared wire event `on_finished_speaking` for both contextual
speech completion and TTS playback completion. Consequently,
`chatContextFinishedSpeaking` can also fire when a TTS request finishes; use the
event as a speech-finished signal rather than as a uniquely identifiable source.

## `layla.chat.completions.create(...)`

Creates a chat completion. Use this when you only need the final assistant message.

```ts
import {
  LaylaSDK,
  type ChatCompletionMessageParam,
} from '@layla-network/sdk';

const layla = new LaylaSDK();

const messages: ChatCompletionMessageParam[] = [
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

### Image input

Image messages use the
[OpenAI Chat Completions content-part shape](https://developers.openai.com/api/reference/resources/chat).
Put text in a `text` part and the image in an `image_url` part. The
`image_url.url` value must be a base64 data URL, including its media type and
`;base64,` prefix:

```ts
const completion = await layla.chat.completions.create({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
            detail: 'auto',
          },
        },
      ],
    },
  ],
});
```

Before posting `send_message`, the SDK joins any `text` parts into the Layla
message's `content` field and moves the data URL into the native protocol's
`image_base64` field. The native protocol supports one image per message, so
the SDK rejects messages with multiple `image_url` parts. Although OpenAI's
shape also permits remote image URLs, Layla's protocol requires base64 data;
remote URLs are therefore rejected. `detail` is accepted for API compatibility
but is not sent because the Layla protocol has no corresponding field.

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
  const choice = chunk.choices[0];
  const content = choice?.delta.content ?? '';
  const reasoning = choice?.delta.reasoning ?? '';

  appendToAssistantMessage(content);
  appendToReasoningPanel(reasoning);
}
```

Breaking out of the `for await` loop aborts the stream.

When the Layla host wraps generated text in `<think>` and `</think>` tags, the
SDK removes those tags from the visible assistant content. Text inside the tags
is streamed as `choices[0].delta.reasoning` and returned on the final
`choices[0].message.reasoning`; text outside the tags remains in
`choices[0].delta.content` and `choices[0].message.content`.

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

## `layla.chat.getInferenceEngines(options?)`

Fetches the inference engines available for subsequent chat completions.

```ts
const engines = await layla.chat.getInferenceEngines();

for (const engineName of engines) {
  console.log(engineName);
}
```

Pass an abort signal as the first argument:

```ts
const engines = await layla.chat.getInferenceEngines({
  signal: controller.signal,
});
```

## `layla.chat.setInferenceEngine(engineName, options?)`

Selects the inference engine used for subsequent chat completions. Use a name
returned by `getInferenceEngines()`, or pass `null` to reset to the host's
default engine.

```ts
const engines = await layla.chat.getInferenceEngines();
const result = await layla.chat.setInferenceEngine(engines[0] ?? null);

if (!result.success) {
  throw new Error('The requested inference engine is unavailable.');
}

console.log(result.engineName); // selected name, or null for the default
```

The host returns `success: false` and resets to its default engine when the
requested name is not found.

Pass an abort signal as the second argument:

```ts
await layla.chat.setInferenceEngine('local-engine', {
  signal: controller.signal,
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
  console.log(chunk.choices[0]?.delta.reasoning ?? '');
});

stream.on('content', logContent);

stream.on('reasoning', (delta, snapshot) => {
  console.log(delta, snapshot);
});

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

## `layla.chat.scheduleChatMessage(message, options?)`

Creates a scheduled chat message and returns the saved
`LaylaScheduledChatMessage`. Pass `id: 0` (or another non-positive value) to
create a scheduled message; the host returns the assigned id.

```ts
const scheduled = await layla.chat.scheduleChatMessage({
  id: 0,
  character_id: character.id,
  session_id: sessionId ?? null,
  timestamp: Date.now() + 60 * 60 * 1000,
  message: 'Check in about the plan in one hour.',
});

console.log(scheduled.id);
```

Pass an abort signal as the second argument:

```ts
const scheduled = await layla.chat.scheduleChatMessage(message, {
  signal: controller.signal,
});
```

## `layla.chat.getScheduledChatMessages(options?)`

Fetches all scheduled chat messages known to the host. The host protocol does
not paginate or filter this response, so filter locally when you only need
messages for one character or session.

```ts
const scheduledMessages = await layla.chat.getScheduledChatMessages();
const forCharacter = scheduledMessages.filter(
  (entry) => entry.character_id === character.id,
);
```

Pass an abort signal as the first argument:

```ts
const scheduledMessages = await layla.chat.getScheduledChatMessages({
  signal: controller.signal,
});
```

## `layla.chat.cancelScheduledChatMessage(id, options?)`

Cancels a scheduled chat message by id. The response contains the requested
`id`, a `success` boolean, and an optional `message` from the host.

```ts
const result = await layla.chat.cancelScheduledChatMessage(scheduled.id);

if (!result.success) {
  throw new Error(result.message ?? 'Unable to cancel scheduled message');
}
```

Pass an abort signal as the second argument:

```ts
const result = await layla.chat.cancelScheduledChatMessage(scheduled.id, {
  signal: controller.signal,
});
```

## `layla.memories.list(characterId, offset?, range?, options?)`

Fetches the newest memories for a specific character. Results come back as a paged array of `LaylaMemory` items in reverse chronological order. Each memory includes the `session_id` of the chat session it belongs to.

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

## `layla.memories.getTopMemories(characterId, limit?, options?)`

Fetches the top memories for a specific character. The host determines the
ranking heuristic, and results come back as `LaylaMemory` items in reverse
chronological order.

```ts
const topMemories = await layla.memories.getTopMemories(character.id, 5);

for (const memory of topMemories) {
  console.log(memory.summary ?? memory.rawText);
}
```

Pass an abort signal as the third argument:

```ts
const topMemories = await layla.memories.getTopMemories(character.id, 5, {
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
    session_id: sessionId,
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

## `layla.personas.get(characterId?, options?)`

Fetches the default persona when `characterId` is omitted or `null`. Pass a
character id to ask the host for that character-specific persona.

```ts
const defaultPersona = await layla.personas.get();

console.log(defaultPersona.name, defaultPersona.description);
```

```ts
const characterPersona = await layla.personas.get(character.id, {
  signal: controller.signal,
});
```

The returned `LaylaPersona` contains:

- `name`
- `description`

## `layla.tts.getVoices(options?)`

Fetches the TTS voices installed in Layla.

```ts
const voices = await layla.tts.getVoices();

for (const voice of voices) {
  console.log(voice.id, voice.name, voice.tags);
}
```

Pass an abort signal as the first argument:

```ts
const voices = await layla.tts.getVoices({
  signal: controller.signal,
});
```

Each `LaylaTTSVoice` contains:

- `id`
- `type`
- `tags`
- `name`

## `layla.tts.generateVoice(ttsVoiceId: string | null, text, options?)`

Generates and plays voice audio on the host device using the selected TTS
voice. The promise resolves after the host emits `on_finished_speaking`, which
means playback has completed. Pass `null` as `ttsVoiceId` to use Layla's global
default TTS voice:

```ts
await layla.tts.generateVoice(
  null,
  'I will use your default Layla voice.',
);
```

Pass a voice ID to use a specific installed voice:

```ts
const [voice] = await layla.tts.getVoices();

if (voice) {
  await layla.tts.generateVoice(
    voice.id,
    'I will say this out loud through Layla.',
  );
}
```

Pass an abort signal as the third argument:

```ts
await layla.tts.generateVoice(voice.id, 'Stop me if the UI changes.', {
  signal: controller.signal,
});
```

Aborting an in-progress `generateVoice(...)` call sends `stop_speaking` to the
host.

## `layla.tts.generateVoiceToFile(ttsVoiceId, text, save?, options?)`

Generates voice audio without playing it. Pass a voice ID or `null` to use
Layla's global default TTS voice. With the default `save: false`, the result's
`audio_data_base64` contains a ready-to-use audio data URI:

```ts
const result: GenerateVoiceToFileResult =
  await layla.tts.generateVoiceToFile(
    null,
    'Generate this line without playing it.',
  );

if (result.success && result.audio_data_base64) {
  audioElement.src = result.audio_data_base64;
}
```

Pass `true` as the third argument to ask the host to save the generated audio
inside the mini-app's private files. The result then contains `filename`
instead of audio data:

```ts
const result = await layla.tts.generateVoiceToFile(
  voice.id,
  'Save this generated line.',
  true,
  { signal: controller.signal },
);

if (!result.success || !result.filename) {
  throw new Error(result.message ?? 'Voice generation failed');
}
```

`GenerateVoiceToFileResult` contains `success`, `audio_data_base64`,
`filename`, and an optional `message`. The audio data includes its data URI
prefix. A saved filename includes its extension.

## `layla.tts.stopSpeaking(options?)`

Stops any in-progress TTS playback on the host device. The promise resolves
after the host emits `on_finished_speaking`, which is also the event used when
normal playback completes.

```ts
stopButton.onclick = () => {
  void layla.tts.stopSpeaking();
};
```

Pass an abort signal as the first argument if the UI no longer needs to wait for
the stop acknowledgement:

```ts
await layla.tts.stopSpeaking({
  signal: controller.signal,
});
```

## Speech-to-text

Microphone speech input uses the `layla.stt` surface. It has three parts: a
`startListening()` request that asks the host to begin capturing microphone
audio, a `speechRecognized` event that delivers transcripts asynchronously as
the host's speech-to-text service recognises them, and a `stopListening()`
request that releases the microphone.

### `layla.stt.startListening(options?)`

Asks the host to start listening on the device microphone. The promise resolves
once the host emits `on_stt_listening_started`, confirming the recogniser
started successfully, or rejects on error/abort. It takes no arguments other
than the shared request options.

```ts
await layla.stt.startListening();
```

Pass an abort signal to stop waiting for the start acknowledgement:

```ts
await layla.stt.startListening({ signal: controller.signal });
```

### `layla.stt.stopListening(options?)`

Asks the host to stop listening and release the microphone. The promise resolves
once the host emits `on_stt_listening_stopped`, or rejects on error/abort. This
stops the host recogniser; it does not remove your `speechRecognized`
subscription — use `off('speechRecognized', ...)` for that.

```ts
await layla.stt.stopListening();
```

### `layla.stt.on('speechRecognized', listener)`

Recognised speech is not returned by `startListening()`; it arrives through the
`speechRecognized` event. Subscribe before (or right after) starting so no
transcript is missed. Each event carries a `transcript` string.

```ts
const onSpeech: STTSpeechRecognizedListener = ({ transcript }) => {
  console.log('Heard:', transcript);
};

layla.stt.on('speechRecognized', onSpeech);

await layla.stt.startListening();

// Later, when the mini-app no longer needs microphone input:
layla.stt.off('speechRecognized', onSpeech);
```

The resource attaches its window `message` listener only while it has
subscribers and detaches it once the last listener is removed with `off(...)`.

## Background audio player

Background music and long-form audio use the separate
`layla.backgroundAudio` surface. Its control methods are fire-and-forget in the
host protocol: each returned promise resolves when the command has been posted
to the WebView bridge, not when playback reaches a particular state.

Start a queue with `start(queueAudioFiles, metadata?)`. Starting again replaces
the current queue. Local paths are resolved from the mini-app root; remote
audio URLs may also be used.

```ts
await layla.backgroundAudio.start(
  ['audio/intro.mp3', 'https://example.com/audio/episode.mp3'],
  {
    title: 'A quiet journey',
    artist: 'Layla Mini-App',
    albumTitle: 'Stories',
    artworkUrl: 'https://example.com/artwork.jpg',
  },
);
```

`artworkUrl`, when provided, must be a remote HTTPS URL. The other metadata
fields are optional and may be shown on the lock screen or in the media
notification.

Control playback with:

```ts
await layla.backgroundAudio.pause();
await layla.backgroundAudio.resume();
await layla.backgroundAudio.skip();   // next track
await layla.backgroundAudio.skip(0);  // zero-based queue index
await layla.backgroundAudio.stop();   // clears and releases the player
```

`pause()` retains the queue and playback position. `stop()` clears the queue,
so playback must be restarted with `start(...)`.

Listen for track changes, periodic status, and queue completion:

```ts
const onTrackChanged: BackgroundAudioTrackChangedListener = ({
  currentIndex,
  previousIndex,
}) => console.log(previousIndex, currentIndex);

const onStatus: BackgroundAudioStatusListener = (status) => {
  console.log(status.playing, status.currentTime, status.duration);
};

const onFinished: BackgroundAudioFinishedListener = () => {
  console.log('The queue finished and the player was released.');
};

layla.backgroundAudio.on('trackChanged', onTrackChanged);
layla.backgroundAudio.on('status', onStatus);
layla.backgroundAudio.on('finished', onFinished);

layla.backgroundAudio.off('trackChanged', onTrackChanged);
layla.backgroundAudio.off('status', onStatus);
layla.backgroundAudio.off('finished', onFinished);
```

Status contains `playing`, `currentIndex`, `currentTime`, `duration`, and
`isLoaded`. The host normally emits status about once per second while active,
but may throttle or suspend it while the app is backgrounded. Do not use status
events to drive queue logic.

## Database

The `layla.db` surface runs SQL against a private sqlite database. Each mini-app
gets its own database; it is not shared with the Layla app or with other
mini-apps, so it is the place to persist structured mini-app state such as
settings, saved records, or caches.

### `layla.db.executeSql(query, params?, options?)`

Asks the host to run a single SQL statement. The promise resolves once the host
emits `on_execute_sql_response`, or rejects on error/abort. Use `?` placeholders
in `query` and pass their values in `params` so the host binds them safely
rather than interpolating untrusted values into the SQL string.

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

The result is an `ExecuteSqlResult` with:

- `rows` — rows returned by a read, each a column-to-value map. Empty for writes.
- `rowsAffected` — number of rows changed by an INSERT/UPDATE/DELETE.
- `insertId` — row id of the last inserted row (0 when not applicable).

Pass an abort signal to stop waiting for the response:

```ts
await layla.db.executeSql('SELECT 1', undefined, { signal: controller.signal });
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

## `layla.images.getImageGenerationModels(options?)`

Returns the image generation models that are immediately available on the host. Models that are not downloaded are omitted. Each entry has an `id`, `name`, and `description`. Pass a model's `id` as the `modelId` argument to `generateImage(...)` to generate with that specific model.

```ts
const models = await layla.images.getImageGenerationModels();

for (const model of models) {
  console.log(model.id, model.name, model.description);
}
```

## `layla.images.generateImage(prompt, onProgress, img2img_base64?, modelId?, options?)`

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

Pass `img2img_base64` when the host should use an existing image as the image-to-image base. Include the data URI prefix, such as `data:image/png;base64,`.

```ts
const imageSrc = await layla.images.generateImage(
  'Restyle this portrait as soft watercolor',
  onProgress,
  sourceImageBase64,
);
```

Pass `modelId` to generate with a specific image model — one of the `id`s returned by `getImageGenerationModels()`. When omitted, the host uses its default image model.

```ts
const [model] = await layla.images.getImageGenerationModels();

const imageSrc = await layla.images.generateImage(
  'A cozy pixel-art study with warm lamplight',
  onProgress,
  undefined,
  model?.id,
);
```

Use an abort signal when the UI can cancel image generation. `img2img_base64` and `modelId` come before the options argument, so pass `undefined` for the ones you are not using:

```ts
const controller = new AbortController();

const imagePromise = layla.images.generateImage(
  prompt,
  onProgress,
  undefined,
  undefined,
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

## `layla.acestep.generateMusic(prompt, onProgress, lyrics?, duration?, options?)`

Generates music with the on-device Ace-Step model. Progress updates are reported through the callback, which receives `progress` (a number between 0 and 1) and a human-readable `status` string. The returned value is a ready-to-use audio source string (a base64 data URI), or `null` if the host does not return audio.

```ts
const audioSrc = await layla.acestep.generateMusic(
  'A dreamy lo-fi hip-hop beat with warm vinyl crackle',
  (progress, status) => {
    setProgress({
      progress,
      status,
    });
  },
);

if (audioSrc) {
  audioElement.src = audioSrc;
}
```

Pass `lyrics` to steer the vocals of the generated track.

```ts
const audioSrc = await layla.acestep.generateMusic(
  'An upbeat indie-pop anthem',
  onProgress,
  'We are running through the city lights tonight',
);
```

Pass `duration` (in seconds) to control the length of the generated music. When omitted, the host uses its default length. `lyrics` and `duration` come before the options argument, so pass `undefined` for the ones you are not using:

```ts
const audioSrc = await layla.acestep.generateMusic(
  'A calm ambient soundscape',
  onProgress,
  undefined, // lyrics
  60, // duration in seconds
);
```

Use an abort signal when the UI can cancel music generation:

```ts
const controller = new AbortController();

const musicPromise = layla.acestep.generateMusic(
  prompt,
  onProgress,
  undefined,
  undefined,
  { signal: controller.signal },
);

controller.abort();

try {
  await musicPromise;
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

`filename` may be a plain name or a relative path that includes folders (for
example `logs/2026-08-29.txt`). The host resolves it inside the mini-app's
private directory, creating any missing parent folders before writing. Paths are
confined to that directory: leading slashes are ignored and `..` segments that
would escape the app folder are rejected, so pass a relative path rather than an
absolute one.

```ts
const contentBase64 = btoa('Hello from Layla.');
const result = await layla.utils.saveFile(
  'logs/hello.txt',
  contentBase64,
  true,
);

if (!result.success) {
  throw new Error(result.message ?? 'Unable to save file');
}
```

The browser mock stores files in browser `localStorage` when `share` is false.
Browsers cannot reproduce the native share sheet, so `share: true` downloads
the file instead without storing it.

Pass an abort signal as the fourth argument:

```ts
await layla.utils.saveFile('hello.txt', contentBase64, false, {
  signal: controller.signal,
});
```

## `layla.utils.readFile(filename, options?)`

Reads a file from the mini-app's private directory. The returned
`content_base64` includes a data URI prefix when the host finds the file, or
`null` when the file cannot be read.

`filename` may be a plain name or a relative path that includes folders (for
example `logs/hello.txt`), matching the path passed to
`layla.utils.saveFile(...)`. Paths are resolved inside the mini-app's private
directory: leading slashes are ignored and `..` segments that would escape the
app folder are rejected.

```ts
const result = await layla.utils.readFile('logs/hello.txt');

if (result.content_base64) {
  downloadLink.href = result.content_base64;
} else {
  throw new Error(result.message ?? 'Unable to read file');
}
```

Pass an abort signal as the second argument:

```ts
await layla.utils.readFile('hello.txt', {
  signal: controller.signal,
});
```

## `layla.utils.listDir(path, options?)`

Lists the contents of a directory inside the mini-app's private directory.
Resolves with an array of entries, each `{ path, is_dir }`, where `path` is the
entry's path relative to the private directory and `is_dir` is `true` for
subdirectories. Recurse into any entry whose `is_dir` is `true` to walk the
tree.

`path` is relative to the private directory; pass `''` (or `'.'`) for the root.
Paths are confined to that directory: leading slashes are ignored and `..`
segments that would escape the app folder are rejected. The host emits
`on_error` if the directory cannot be read.

```ts
const entries: ListDirResult = await layla.utils.listDir('logs');

for (const entry of entries) {
  if (entry.is_dir) {
    const children = await layla.utils.listDir(entry.path);
    // ...recurse
  } else {
    const file = await layla.utils.readFile(entry.path);
    // ...
  }
}
```

Pass an abort signal as the second argument:

```ts
await layla.utils.listDir('logs', { signal: controller.signal });
```

## `layla.utils.deleteFileOrDir(path, options?)`

Deletes a file or directory inside the mini-app's private directory. Deleting a
directory removes its contents as well. Resolves once the host confirms the
deletion (the result is `null`), or rejects on error/abort.

`path` is relative to the private directory. Paths are confined to that
directory: leading slashes are ignored and `..` segments that would escape the
app folder are rejected. The host emits `on_error` if the deletion fails.

```ts
await layla.utils.deleteFileOrDir('logs/2026-08-29.txt');

// Remove a whole folder and everything under it:
await layla.utils.deleteFileOrDir('logs');
```

Pass an abort signal as the second argument:

```ts
await layla.utils.deleteFileOrDir('logs/hello.txt', {
  signal: controller.signal,
});
```

## Abort Signals

Chat, character requests, classifier requests, image generation, and music generation can be cancelled from the mini-app.

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
    const image = messages.at(-1)?.image_base64;
    console.log(image); // Normalized data URL received by the mock host.
    return `Mock response to: ${last}`;
  },
});
```

The mock receives the same normalized `LaylaChatMessage[]` wire payload as the
native host. Its default reply also notes when the last user message contains
an image, which makes image-input UI easy to exercise locally.

Customize the inference engines exposed by the mock:

```ts
installLaylaMock({
  inferenceEngines: ['local-fast', 'local-quality'],
});

const engines = await layla.chat.getInferenceEngines();
await layla.chat.setInferenceEngine(engines[0] ?? null);
```

The mock accepts names in `inferenceEngines` and `null`. An unknown name returns
`success: false`, resets the mock to its default engine, and reports
`engineName: null`.

Customize and exercise the contextual surface:

```ts
const character = makeMockCharacter('Aria');
const mock = installLaylaMock({
  characters: [character],
  executionContext: {
    app_version: '1.8.0',
    character,
    session_id: 'mock-aria-session-1',
  },
});

const context = await layla.contextual.getExecutionContext();

layla.contextual.on('chatContextNewMessage', ({ message }) => {
  console.log(message.content);
});
layla.contextual.on('chatContextSentimentUpdate', ({ sentiment }) => {
  console.log(sentiment);
});
layla.contextual.on('chatContextStartedSpeaking', () => {
  console.log('The contextual character started speaking.');
});
layla.contextual.on('chatContextFinishedSpeaking', () => {
  console.log('The contextual character finished speaking.');
});
layla.contextual.on('chatContextStartedThinking', () => {
  console.log('The contextual character started thinking.');
});

mock.emitChatContextNewMessage({
  message: { role: 'user', content: 'Hello from the surrounding chat.' },
  character_id: character.id,
  session_id: context.session_id ?? 'mock-aria-session-1',
  timestamp: Date.now(),
});
mock.emitChatContextSentimentUpdate({ sentiment: 'joy' });
mock.emitChatContextStartedSpeaking();
mock.emitChatContextFinishedSpeaking();
mock.emitChatContextStartedThinking();
```

When `executionContext` is omitted, the mock returns `{ app_version: 'mock',
character: null, session_id: null }`, representing a standalone top-level
mini-app. The mock handle's `emitChatContext...` methods let local tests drive
the same pushed events that the Layla host emits.

Exercise the speech-to-text surface:

```ts
const mock = installLaylaMock();

layla.stt.on('speechRecognized', ({ transcript }) => {
  console.log('Heard:', transcript);
});

// Resolves when the mock confirms listening started, then it auto-emits one
// canned `speechRecognized` event shortly after.
await layla.stt.startListening();

// Drive additional recognised-speech events manually:
mock.emitSTTSpeechRecognized({ transcript: 'A second recognised phrase.' });

// Release the microphone; the mock confirms with `on_stt_listening_stopped`.
await layla.stt.stopListening();
```

By default the mock emits a sample transcript shortly after `startListening()`
succeeds. Pass `sttTranscript` to change that phrase, or set it to `null` to
disable the automatic event and drive recognised speech only through
`mock.emitSTTSpeechRecognized(...)`.

Exercise the database surface:

```ts
const rows: Record<string, unknown>[] = [];

installLaylaMock({
  executeSql: (query, params) => {
    if (query.startsWith('INSERT')) {
      rows.push({ id: rows.length + 1, body: params[0] });
      return { rows: [], rowsAffected: 1, insertId: rows.length };
    }
    return { rows: [...rows], rowsAffected: 0, insertId: 0 };
  },
});

await layla.db.executeSql('INSERT INTO notes (body) VALUES (?)', ['hello']);
const read = await layla.db.executeSql('SELECT * FROM notes');
console.log(read.rows);
```

The browser mock has no real sqlite. When the `executeSql` handler is omitted,
every query resolves to an empty result
(`{ rows: [], rowsAffected: 0, insertId: 0 }`). Provide the handler to return
your own results, or to back the mock with an in-browser SQL engine such as
sql.js for realistic local testing.

Customize Ace-Step music generation, including the progress it streams:

```ts
installLaylaMock({
  aceStepGenerate: async ({ prompt, lyrics, duration }, reportProgress) => {
    for (let step = 1; step <= 4; step++) {
      reportProgress({ progress: step / 4, status: `Composing (${step}/4)` });
      await new Promise((r) => setTimeout(r, 100));
    }
    return { audio_data_base64: 'data:audio/wav;base64,UklGRi...' };
  },
});

const audio = await layla.acestep.generateMusic(
  'lofi beats to test to',
  (progress, status) => console.log(progress, status),
);
```

The handler receives the `{ prompt, lyrics, duration }` request and a
`reportProgress` function that emits `on_ace_step_generate_progress` events
(each with `progress` 0..1 and a `status` string) to the app's `onProgress`
callback. Return the final result (`audio_data_base64`, which should include a
data URI prefix, plus an optional `message`); it may be async. When the handler
is omitted, the mock streams five canned progress ticks and returns a tiny
placeholder WAV data URI.

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

Customize mock scheduled messages with static schedule data:

```ts
installLaylaMock({
  scheduledChatMessages: [
    {
      id: 1,
      character_id: 'mock-aria',
      session_id: 'mock-aria-session-1',
      timestamp: Date.now() + 60 * 60 * 1000,
      message: 'Follow up on the saved idea.',
    },
  ],
});

const scheduled = await layla.chat.getScheduledChatMessages();
const saved = await layla.chat.scheduleChatMessage({
  id: 0,
  character_id: 'mock-aria',
  session_id: null,
  timestamp: Date.now() + 2 * 60 * 60 * 1000,
  message: 'Start a fresh check-in later.',
});
await layla.chat.cancelScheduledChatMessage(saved.id);
```

Scheduled messages created through the mock are available to later
`layla.chat.getScheduledChatMessages()` calls in the same mock session.

Customize mock memories with static memory data:

```ts
installLaylaMock({
  memories: [
    {
      id: 1,
      character_id: 'mock-aria',
      session_id: 'mock-aria-session-1',
      rawText: 'Aria remembers that Alex likes quiet mornings.',
      timestamp: Date.now(),
      summary: 'Alex likes quiet mornings.',
      knowledgeGraphJSON: null,
    },
  ],
});

const memories = await layla.memories.list('mock-aria');
const topMemories = await layla.memories.getTopMemories('mock-aria', 3);
```

When `memories` is omitted, the mock supplies a small memory set per default
character. The top-memories mock response filters those same memories by
character and returns the newest entries up to the requested limit.

Customize mock personas:

```ts
installLaylaMock({
  persona: {
    name: 'Alex',
    description: 'A thoughtful local-development user persona.',
  },
  personas: {
    'mock-aria': {
      name: 'Aria',
      description: 'A focused character-specific mock persona.',
    },
  },
});

const defaultPersona = await layla.personas.get();
const ariaPersona = await layla.personas.get('mock-aria');
```

When `persona` is omitted, the mock supplies a default persona. When
`personas` is omitted, the mock derives character-specific personas from the
mock character cards.

Customize mock TTS voices:

```ts
installLaylaMock({
  ttsVoices: [
    {
      id: 'local-narrator',
      type: 'mock',
      tags: ['narrator', 'demo'],
      name: 'Local Narrator',
    },
  ],
});

const voices = await layla.tts.getVoices();
await layla.tts.generateVoice(voices[0].id, 'Preview this voice.');
await layla.tts.generateVoice(null, 'Preview the global default voice.');
const audio = await layla.tts.generateVoiceToFile(
  null,
  'Generate a mock audio data URI.',
);
const savedAudio = await layla.tts.generateVoiceToFile(
  null,
  'Save a mock audio file.',
  true,
);
await layla.tts.stopSpeaking();
```

The browser mock does not synthesize audio; `generateVoice(...)` waits for the
mock latency and then emits `on_finished_speaking`, whether passed a configured
voice ID or `null` for the global default. `stopSpeaking()` immediately emits
the same completion event and cancels any pending mock TTS completion.
`generateVoiceToFile(...)` returns a small mock WAV data URI, or saves
`mock-voice.wav` to mock private-file storage when `save` is true.

The background-audio mock emits status updates as start, pause, resume, and
skip commands change its simulated state. The mock handle can also drive any
background-audio event directly:

```ts
const mock = installLaylaMock();

layla.backgroundAudio.on('status', console.log);
await layla.backgroundAudio.start(['intro.mp3', 'chapter-1.mp3']);
await layla.backgroundAudio.skip();

mock.emitBackgroundAudioTrackChanged({
  previousIndex: 0,
  currentIndex: 1,
});
mock.emitBackgroundAudioStatus({
  playing: true,
  currentIndex: 1,
  currentTime: 12,
  duration: 90,
  isLoaded: true,
});
mock.emitBackgroundAudioFinished();
```

Fully override the private-file surface with the `saveFile`, `readFile`,
`listDir`, and `deleteFileOrDir` handlers. Back all four with a single store to
get a coherent mock filesystem:

```ts
const store = new Map<string, string>();

installLaylaMock({
  saveFile: ({ filename, contentBase64, share }) => {
    store.set(filename, contentBase64);
    return { filename, success: true };
  },
  readFile: ({ filename }) => {
    const contentBase64 = store.get(filename);
    return contentBase64 === undefined
      ? { filename, content_base64: null, message: 'Not found.' }
      : { filename, content_base64: `data:application/octet-stream;base64,${contentBase64}` };
  },
  listDir: ({ path }) =>
    [...store.keys()]
      .filter((key) => key.startsWith(path))
      .map((key) => ({ path: key, is_dir: false })),
  deleteFileOrDir: ({ path }) => {
    for (const key of store.keys()) {
      if (key === path || key.startsWith(`${path}/`)) store.delete(key);
    }
  },
});

await layla.utils.saveFile('hello.txt', 'SGVsbG8gZnJvbSBMYXlsYS4=');
const result = await layla.utils.readFile('hello.txt');
const entries = await layla.utils.listDir('');
await layla.utils.deleteFileOrDir('hello.txt');
```

All four handlers may be async, so you can back them with any store you like (an
in-memory map, IndexedDB, a remote fixture server, etc.), and control
success/error results per call. `readFile` should return `content_base64` with a
data URI prefix (or `null`, with an optional `message`, to simulate a missing or
unreadable file), mirroring the real host. `deleteFileOrDir` performs the
deletion and returns nothing; throw from it to simulate a failure (the mock
emits `on_error` with the thrown message).

When these handlers are omitted, the mock falls back to browser `localStorage`:
files saved through `layla.utils.saveFile(...)` with `share: false` are stored
there, so later `layla.utils.readFile(...)` calls can read them on the same
origin, while files downloaded with `share: true` are not stored.
`layla.utils.listDir(...)` and `layla.utils.deleteFileOrDir(...)` then operate
over this same `localStorage`-backed store, deriving a virtual directory tree
from the stored file paths. Each handler is independent — override only the ones
you need and the rest keep the `localStorage` default.

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
- `LaylaScheduledChatMessage`
- `LaylaMemory`
- `LaylaPersona`
- `LaylaTTSVoice`
- `GenerateVoiceToFileResult`
- `ExecuteSqlResult`
- `STTSpeechRecognized`
- `STTSpeechRecognizedListener`
- `BackgroundAudioMetadata`
- `BackgroundAudioTrackChanged`
- `BackgroundAudioTrackChangedListener`
- `BackgroundAudioStatus`
- `BackgroundAudioStatusListener`
- `BackgroundAudioFinished`
- `BackgroundAudioFinishedListener`
- `LaylaExecutionContext`
- `ChatContextFinishedSpeaking`
- `ChatContextFinishedSpeakingListener`
- `ChatContextNewMessage`
- `ChatContextNewMessageListener`
- `ChatContextSentimentUpdate`
- `ChatContextSentimentUpdateListener`
- `ChatContextStartedSpeaking`
- `ChatContextStartedSpeakingListener`
- `ChatContextStartedThinking`
- `ChatContextStartedThinkingListener`
- `MemoryListOptions`
- `LaylaApiEvent_onGetChatSessionsResponse`
- `LaylaApiSaveChatMessage`
- `LaylaApiEvent_onSaveChatMessageResponse`
- `LaylaApiScheduledChatMessage`
- `LaylaApiGetScheduledChatMessages`
- `LaylaApiCancelScheduledChatMessage`
- `LaylaApiEvent_onScheduledChatMessage`
- `LaylaApiEvent_onGetScheduledChatMessagesResponse`
- `LaylaApiEvent_onCancelScheduledChatMessage`
- `LaylaApiGetMemories`
- `LaylaApiGetTopMemories`
- `LaylaApiCreateOrUpdateMemories`
- `LaylaApiGetPersona`
- `LaylaApiGetTTSVoices`
- `LaylaApiGenerateVoice`
- `LaylaApiGenerateVoiceToFile`
- `LaylaApiStopSpeaking`
- `LaylaApiSTTStartListening`
- `LaylaApiSTTStopListening`
- `LaylaApiExecuteSql`
- `LaylaApiAceStepGenerate`
- `LaylaApiEvent_onAceStepGenerateResponse`
- `LaylaApiEvent_onAceStepGenerateProgress`
- `LaylaApiStartBackgroundAudioPlayer`
- `LaylaApiStopBackgroundAudioPlayer`
- `LaylaApiPauseBackgroundAudioPlayer`
- `LaylaApiResumeBackgroundAudioPlayer`
- `LaylaApiSkipBackgroundAudioTrack`
- `LaylaApiGetInferenceEngines`
- `LaylaApiSetInferenceEngine`
- `LaylaApiGetExecutionContext`
- `LaylaApiEvent_onGetMemoriesResponse`
- `LaylaApiEvent_onGetTopMemoriesResponse`
- `LaylaApiEvent_onCreateOrUpdateMemoriesResponse`
- `LaylaApiEvent_onGetPersonaResponse`
- `LaylaApiEvent_onGetTTSVoicesResponse`
- `LaylaApiEvent_onGetInferenceEnginesResponse`
- `LaylaApiEvent_onSetInferenceEngineResponse`
- `LaylaApiEvent_onGetExecutionContextResponse`
- `LaylaApiEvent_onChatContextFinishedSpeaking`
- `LaylaApiEvent_onChatContextNewMessage`
- `LaylaApiEvent_onChatContextSentimentUpdate`
- `LaylaApiEvent_onChatContextStartedSpeaking`
- `LaylaApiEvent_onChatContextStartedThinking`
- `LaylaApiEvent_onFinishedSpeaking`
- `LaylaApiEvent_onGenerateVoiceToFileResponse`
- `LaylaApiEvent_onBackgroundAudioTrackChanged`
- `LaylaApiEvent_onBackgroundAudioStatus`
- `LaylaApiEvent_onBackgroundAudioFinished`
- `LaylaApiEvent_onSTTListeningStarted`
- `LaylaApiEvent_onSTTSpeechRecognized`
- `LaylaApiEvent_onSTTListeningStopped`
- `LaylaApiEvent_onExecuteSqlResponse`
- `LaylaApiSaveFile`
- `LaylaApiEvent_onSaveFileResponse`
- `LaylaApiReadFile`
- `LaylaApiEvent_onReadFileResponse`
- `LaylaApiListDir`
- `LaylaApiEvent_onListDirResponse`
- `LaylaApiDeleteFileOrDir`
- `LaylaApiEvent_onDeleteFileOrDirResponse`
- `ReadFileResult`
- `SaveFileResult`
- `ListDirResult`
- `DeleteFileOrDirResult`
- `LaylaCharacter`
- `TavernCardV2`
- `SentimentValues`
- `TavernCharacterBook`
- `ChatCompletion`
- `ChatCompletionChunk`
- `ChatCompletionMessageParam`
- `ChatCompletionContentPart`
- `ChatCompletionContentPartText`
- `ChatCompletionContentPartImage`
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
- `src/resources/acestep.ts`
- `src/resources/memories.ts`
- `src/resources/personas.ts`
- `src/resources/tts.ts`
- `src/resources/stt.ts`
- `src/resources/db.ts`
- `src/resources/background-audio.ts`
- `src/resources/contextual.ts`
- `src/resources/utils.ts`
- `src/protocol.ts`
- `src/interface.ts`
- `src/typescript-protocol.ts`
- `src/errors.ts`
- `src/mock.ts`
