# Layla SDK

<table>
  <tr>
    <td>
      <img src="assets/layla.png" alt="Layla butterfly logo" width="160">
    </td>
    <td>
      The Layla SDK project provides the public TypeScript SDK for building custom Layla mini-apps. Mini-apps run inside Layla's WebView and can use <code>@layla-network/sdk</code> to talk to Layla app host through an OpenAI-shaped API for chat, tool calling, multimodal image input, streaming responses, contextual character-chat state and events, out-of-band side questions about the current chat, inference engine selection, scheduled chat messages and mini-app notifications, characters, character images, personas, memories, TTS playback and audio-file generation, speech-to-text microphone input, background audio playback, image generation, still-image-to-video generation with NeoDragon, WAN video generation with Nightmare Mobile, music generation with the Ace-Step model (the one-call pipeline plus its raw passes), a private per-mini-app sqlite database, private file utilities, Layla Cloud sign-in, and local development mocks.
    </td>
  </tr>
</table>

## Project Links

- [Docs](.agents/layla-sdk/references/) - mini-app packaging guidance and the SDK API reference.
- [SDK source](src/) - the TypeScript source for `@layla-network/sdk`.
- [Examples](examples/) - sample Layla mini-apps showing chat, chess, tarot, and character generation workflows.
- [Agent skill](https://github.com/l3utterfly/layla-sdk/releases?q=agent+skill&expanded=true) - a packaged skill that helps other coding agents understand how to create Layla mini-apps with this SDK.

## Getting Started

Install the SDK from npm:

```bash
npm install @layla-network/sdk
```

Create a client in a Layla mini-app:

```ts
import { LaylaSDK } from '@layla-network/sdk';

const layla = new LaylaSDK();
```

The SDK is designed for Layla's WebView runtime. It does not require an API key, base URL, or direct network LLM endpoint; requests are sent through the Layla host bridge.

## Saving Chat History

Save separate text for chat display and for the LLM:

```ts
const saved = await layla.chat.saveChatMessage({
  id: 0,
  session_id: sessionId,
  character_id: character.id,
  display_message: 'Here is your summary.',
  message: 'Here is your summary. Additional context for the next turn: ...',
  timestamp: 0,
});
console.log(saved.id, saved.timestamp);
```

`SaveChatMessageParams` and `SaveChatMessageResult` are exported from the package
root. Use `character_id: 'user'` for a user entry. An `id <= 0` creates an entry;
a positive ID overwrites all fields of an existing entry and rejects if that ID
does not exist. A `timestamp <= 0` uses the host's current time. Updates keep an
existing image; new entries have no image. Only character entries create missing
sessions.

The result includes both text fields, the assigned ID, and the stored timestamp.

## Background Audio

Start a queue with metadata for each track:

```ts
await layla.backgroundAudio.start([
  { file: 'chapter-1.mp3', title: 'Chapter 1', artist: 'Narrator' },
  { file: 'chapter-2.mp3', title: 'Chapter 2', artist: 'Narrator' },
]);
```

Track objects use the host's `start_background_audio_player_v2` command. The existing `start(['chapter-1.mp3'], { title: 'Book' })` signature is deprecated but still sends the original command unchanged. An empty array also uses the original command to preserve compatibility. The `BackgroundAudioTrack` type is exported for typed queues.

## Out-of-Band Messages

Ask the current chat a quick side question without adding anything to its history:

```ts
const reply = await layla.contextual.sendOutOfBandMessage(
  'Should the character send a picture now? Reply as JSON: {"send": true|false}.',
  {
    jsonSchema: {
      type: 'object',
      properties: { send: { type: 'boolean' } },
      required: ['send'],
    },
  },
);

const { send } = JSON.parse(reply);
```

The reply is generated against the conversation built up by
`chat.completions` requests, but neither the message nor the reply enters that
history, and nothing is streamed. An `imageBase64` option attaches an image.
`jsonSchema` is best-effort — engines without constrained decoding ignore it —
so describe the format in the message too and validate the reply.

## Image Generation with References

Pass reference images in the fifth argument's `referenceImages` option:

```ts
const imageSrc = await layla.images.generateImage(
  'Paint the subject from these references in a watercolor garden',
  (status, step, totalSteps) => console.log(status, step, totalSteps),
  undefined, // optional img2img base image
  referenceModelId, // an available model that supports reference images
  { referenceImages: [portraitDataUri, styleDataUri] },
);

if (imageSrc) imageElement.src = imageSrc;
```

Each reference must be a base64 image data URI, including a prefix such as
`data:image/png;base64,`. Raw base64 and remote URLs are not accepted. References
provide native edit conditioning and can be combined with the existing
`img2img_base64` base image. `GenerateImageOptions` is exported from the package
root and also accepts an abort `signal`.

This requires a Layla host build implementing `generate_image.reference_images`.
On such a host, a model without reference image support rejects a non-empty array
with `LaylaError`; omitted or empty references preserve ordinary generation.
Older hosts may ignore the field. The browser mock returns its placeholder image
and does not simulate model support.

## Image Generation Tag Dictionaries

Use the `images` surface to browse and edit text tag dictionaries:

```ts
const [dictionary] = await layla.images.getTagDictionaries();
if (dictionary) {
  const filename = dictionary.dictionary_filename;
  const page = await layla.images.getTags(filename, { offset: 0, limit: 50 });
  const suggestions = await layla.images.suggestTags(filename, 'blu hr', { limit: 40 });
  const matches = await layla.images.searchTags(filename, 'blue', { mode: 'prefix' });
  const tag = await layla.images.getTag(filename, 'blue_hair'); // null if absent
  if (tag) {
    // Supply the existing name to replace or rename it. Omit it to create a tag.
    await layla.images.upsertTag(filename, { ...tag, english: 'azure_hair' }, tag.english);
    await layla.images.deleteTag(filename, 'azure_hair'); // boolean: was a tag deleted?
  }
  console.log(page.total, matches.tags, suggestions);
}
```

Each call supplies its own dictionary filename, such as `my-dictionary/tags.csv`,
relative to Layla's app-data tags folder. Absolute paths, URIs, backslashes, and
empty, `.` or `..` path segments are rejected. Dictionaries are shared with the
host tag manager; successful edits are saved before the promise resolves.

`upsertTag(filename, tag)` also creates the dictionary CSV and any parent folders
when the filename does not exist. The tag is validated before the new file is
written. Passing an existing name as `replacing` still requires that tag to
exist. Existing unreadable or malformed files are rejected rather than reset.
Auto-created raw CSVs can be accessed directly by filename; dictionary discovery
continues to list dictionaries registered in the host tag manager.

Tags have `{ english, category, post_count, aliases }`. Listing and search return
`{ dictionary_filename, tags, total, offset, limit }`; search also returns `query`
and the resolved `mode`. Both accept optional `category`, `offset` (default 0),
and `limit` (default 50). Search defaults to substring matching (`mode: 'name'`),
ignores case, and treats spaces/dashes as underscores. Exact canonical names
come first. All seven methods accept an abort `signal` in their options.

Use `suggestTags` for prompt autocomplete: it calls the same indexed engine as
the native tag picker, with fuzzy matching, aliases, typo correction, translation
search and popularity ranking. It returns up to 40 suggestions by default, with
`replacement_tag`, `primary_text`, optional `secondary_text`, `match_type`,
`category`, `post_count` and `score`. Blank queries and `limit: 0` return `[]`.
Pass the current tag token, and debounce interactive calls by 150 ms as the
picker does. Suggestions have no pagination or total count; `searchTags` remains
the paginated name/prefix browsing API. First use or a dictionary change still
requires loading and indexing; subsequent suggestions reuse the prepared index.

Requires a host implementing the `image_gen_tag_*` commands. Browser development
can seed `installLaylaMock({ imageTagDictionaries: { 'demo/tags.csv': tags } })`;
mock edits last until uninstall and do not write real dictionaries.
The browser mock approximates fuzzy name/alias suggestions; native translation
and typo-correction ranking are tested on the host.

## Video Generation

Generate an MP4 from a still image with NeoDragon:

```ts
const result = await layla.neodragon.generateVideo(
  sourceImageDataUri,
  'A slow camera push-in while the leaves move in a gentle breeze',
  {
    fps: 24,
    onProgress: ({ stage, fraction }) => {
      console.log(stage, Math.round(fraction * 100));
    },
  },
);

videoElement.src = result.video_data_base64;
```

The source image and returned MP4 include their `data:` URI prefixes. Options
also support a reproducible `seed`, native-resolution output with
`upscale: false`, `cinematicPrompt`, a normalized source `crop`, and an abort
signal. The host must implement the `neodragon_generate_video` protocol
command; keep the SDK and Layla host versions synchronized when using this
surface.

## Nightmare Mobile Video Generation

List the WAN model catalog, then choose a downloaded model:

```ts
const models = await layla.nightmareMobile.getModels();
const model = models.find(({ downloaded }) => downloaded);
if (!model) throw new Error('Download a Nightmare Mobile model in Layla first');

const result = await layla.nightmareMobile.generateVideo(
  model.id,
  'Waves roll onto the beach, fixed camera',
  {
    width: 640,
    height: 352,
    frames: 49,
    fps: 24,
    onProgress: (progress) => console.log(progress.stage, progress),
  },
);
videoElement.src = result.video_data_base64;
```

Options also accept `negativePrompt`, `seed` (number or decimal string),
`imageDataBase64`, `endImageDataBase64`, `denoiseStrength`, and an abort `signal`.
Image inputs must include their base64 data URI prefixes. The returned seed is a
decimal string, preserving 64-bit precision.

Each call reads the latest UI-saved `sdcpp.json` and overrides only supplied
controls. Omitted settings, including saved start/end images, are inherited.
Model capabilities and UI limits returned by `getModels()` are advisory; the
host applies basic input validation and lets the engine determine support.
LoRAs and sampling remain in the saved configuration. Use `width`/`height` and
`frames`/`fps`; there are no aspect-ratio or duration request options.

Progress describes phases, sampling passes/steps, and encoded frames. Aborting
rejects locally while native generation continues. Requires a Layla host build
with `nightmaremobile_get_models` and `nightmaremobile_generate_video` support.

## Ace-Step Models

List locally known music-model bundles and select one per generation request:

```ts
const models = await layla.acestep.getModels();
const model = models.find(({ ready_for_use }) => ready_for_use);
if (!model) throw new Error('No Ace-Step model is ready');

const audio = await layla.acestep.generateMusic(
  'A dreamy lo-fi hip-hop beat',
  (progress, status) => console.log(progress, status),
  undefined,
  30,
  { modelId: model?.modelId },
);
```

Built-in bundles are returned even when unavailable; check `ready_for_use`
before offering one. Raw `lm`, `synth`, `understand`, `vaeEncode`, and
`vaeDecode` calls also accept `modelId` in their options. Keep the same ID
across related raw passes.

## Layla Cloud

Get an access token for the Layla Cloud account signed in on the device:

```ts
const accessToken = await layla.cloud.login();

if (accessToken === null) {
  // The user declined to log in — carry on without cloud features.
  return;
}

const response = await fetch('https://api.layla-network.ai/some/endpoint', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

The host owns the sign-in flow, so the call can stay pending while the user
logs in; it resolves with `null` when they decline. Call Layla Cloud HTTP APIs
with ordinary `fetch` and the token as the Bearer header — the SDK does not
proxy them.

## Version Requirements

The SDK talks to whatever Layla app it finds itself in, and takes the richest route that app supports. Most of the API works everywhere, but chat has two paths:

| Capability | Requires |
| --- | --- |
| Tool calling — `tools`, `tool_choice`, `tool` messages, and `tool_calls` on the reply | Layla **v7.5.0-alpha** or newer, and `@layla-network/sdk` **7.5.0** or newer |
| The full OpenAI request body reaching the model untranslated (multi-part content, several images per turn, an assistant turn's `tool_calls`) | Layla **v7.5.0-alpha** or newer, and `@layla-network/sdk` **7.5.0** or newer |
| Still-image-to-video generation | A Layla host build with `neodragon_generate_video` support and an SDK release exposing `layla.neodragon` |
| Nightmare Mobile WAN video generation | A Layla host build implementing `nightmaremobile_get_models` and `nightmaremobile_generate_video`, and an SDK release exposing `layla.nightmareMobile` |
| Out-of-band messages | A Layla host build with `send_out_of_band_message` support and an SDK release exposing `layla.contextual.sendOutOfBandMessage` |
| Separate display and LLM text in saved chat entries | A Layla host build implementing the updated `save_chat_message` contract |
| Reference images for image generation | A Layla host build implementing `generate_image.reference_images`, a compatible image model, and an SDK release exposing `GenerateImageOptions.referenceImages` |
| Image generation tag dictionaries | A Layla host build implementing the `image_gen_tag_*` commands and an SDK release exposing the tag methods on `layla.images` |
| Everything else — chat, streaming, one image per message, characters, memories, TTS, images, music, database, files | Any supported Layla version |

Call sites are identical on both paths: the SDK reads the host version itself and routes accordingly. On an older host the request is translated into Layla's narrower native protocol, and anything it cannot carry — `tools` among it — is dropped with a `console.warn` rather than rejected. A mini-app that depends on tool calling should check the host version before offering the feature:

```ts
const { app_version } = await layla.contextual.getExecutionContext();
```

## Using the SDK with Agents

This SDK contains an agent skill that can be imported into other agents to enable Layla mini-app creation. The skill provides tools that wrap the SDK methods, allowing agents to generate mini-apps in response to user requests.

An agent skill bundle is generated on every release: https://github.com/l3utterfly/layla-sdk/releases?q=agent+skill&expanded=true

Download the zip file for the latest skill release and import it into your agent to get started. The skill includes example prompts and tool calls to help your agent learn how to use the SDK.

Example prompt with Claude Code:
```
Create a Layla mini-app using the layla-sdk skill. In the mini-app, you can play truth or dare with any character of your choosing, there should be a button next to each chat message to generate an image using the contents of the message as the prompt (including the character description)
```

This skill can be imported into any coding agent, such as Codex, Claude Code, or OpenCode etc.

### Recommended Project Structure for more complex mini-apps

If you want to create more complex mini-apps with multiple source files, states, and pages. We recommend using a framework like Vite to build a ReactJS or VueJS app. You can then bundle the app into a single `index.html` file that can be imported into Layla as a mini-app.

Here is a starter project: https://github.com/l3utterfly/layla-miniapp-template

Open the project in any coding agent with the `layla-sdk` skill imported, and ask it to build out the mini-app with the SDK.

## Releases

Each release contains:

1. SDK source code as a zip file. The SDK package is also published to npm automatically.
2. Example mini-apps as a zip file that can be imported into Layla directly.
3. An agent skills zip file that can be imported into other agents so they can create Layla mini-apps for you.

## Learn More

- Read the [mini-apps overview](.agents/layla-sdk/references/mini-apps-overview.md) to understand app packaging, metadata, and the Layla WebView runtime.
- Read the [SDK API reference](.agents/layla-sdk/references/sdk-api.md) for imports, contextual execution state, chat events, and out-of-band messages, chat completions, streaming, tool calling, inference engine selection, chat sessions, session history, message saves, scheduled chat messages and mini-app notifications, memory list/top/save APIs, personas, TTS playback and audio-file generation, speech-to-text microphone input and events, background audio controls and events, characters, image generation, still-image-to-video generation, music generation and the raw Ace-Step passes, a private per-mini-app sqlite database, file utilities, Layla Cloud sign-in, abort handling, and errors.
- Browse the [examples guide](examples/ReadMe.md) to choose a starting mini-app.

## Layla App

Visit the official Layla website: https://www.layla-network.ai/

Download the Layla app:

<p>
  <a href="https://play.google.com/store/apps/details?id=com.layla">
    <img src="./assets/google_badge.png" alt="Get it on Google Play" height="60">
  </a>
  &nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/layla/id6456886656">
    <img src="./assets/apple_badge.png" alt="Download on the App Store" height="60">
  </a>
</p>
