# Layla SDK

<table>
  <tr>
    <td>
      <img src="assets/layla.png" alt="Layla butterfly logo" width="160">
    </td>
    <td>
      The Layla SDK project provides the public TypeScript SDK for building custom Layla mini-apps. Mini-apps run inside Layla's WebView and can use <code>@layla-network/sdk</code> to talk to Layla app host through an OpenAI-shaped API for chat, tool calling, multimodal image input, streaming responses, contextual character-chat state and events, inference engine selection, scheduled chat messages and mini-app notifications, characters, character images, personas, memories, TTS playback and audio-file generation, speech-to-text microphone input, background audio playback, image generation, music generation with the Ace-Step model (the one-call pipeline plus its raw passes), a private per-mini-app sqlite database, private file utilities, and local development mocks.
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

## Background Audio

Start a queue with metadata for each track:

```ts
await layla.backgroundAudio.start([
  { file: 'chapter-1.mp3', title: 'Chapter 1', artist: 'Narrator' },
  { file: 'chapter-2.mp3', title: 'Chapter 2', artist: 'Narrator' },
]);
```

Track objects use the host's `start_background_audio_player_v2` command. The existing `start(['chapter-1.mp3'], { title: 'Book' })` signature is deprecated but still sends the original command unchanged. An empty array also uses the original command to preserve compatibility. The `BackgroundAudioTrack` type is exported for typed queues.

## Version Requirements

The SDK talks to whatever Layla app it finds itself in, and takes the richest route that app supports. Most of the API works everywhere, but chat has two paths:

| Capability | Requires |
| --- | --- |
| Tool calling — `tools`, `tool_choice`, `tool` messages, and `tool_calls` on the reply | Layla **v7.5.0-alpha** or newer, and `@layla-network/sdk` **7.5.0** or newer |
| The full OpenAI request body reaching the model untranslated (multi-part content, several images per turn, an assistant turn's `tool_calls`) | Layla **v7.5.0-alpha** or newer, and `@layla-network/sdk` **7.5.0** or newer |
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
- Read the [SDK API reference](.agents/layla-sdk/references/sdk-api.md) for imports, contextual execution state and chat events, chat completions, streaming, tool calling, inference engine selection, chat sessions, session history, message saves, scheduled chat messages and mini-app notifications, memory list/top/save APIs, personas, TTS playback and audio-file generation, speech-to-text microphone input and events, background audio controls and events, characters, image generation, music generation and the raw Ace-Step passes, a private per-mini-app sqlite database, file utilities, abort handling, and errors.
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
