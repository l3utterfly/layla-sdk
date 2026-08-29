# Layla Mini-Apps Overview

A Layla mini-app is a self-contained HTML app that can be loaded into Layla. It can be written with any web stack, but the final artifact Layla loads is either a single HTML file or a URL pointing to one.

Mini-apps run inside Layla's React Native WebView. When running inside Layla, they can use `@layla-network/sdk` to talk to the Layla host through the WebView bridge.

## How Mini-Apps Are Stored

Inside Layla, each imported mini-app is stored in its own folder. The folder name is generated from the app name as a slug.

```text
app-name-generated-slug/
  app.json
  index.html
  task.js        (optional background task)
  icon.png
  other-assets...
```

or:

```text
app-name-generated-slug/
  app.json
  index.url
  icon.png
  other-assets...
```

The required entry file is one of:

- `index.html`: a self-contained HTML file that Layla loads directly.
- `index.url`: a text file containing one line, the URL Layla should load.

Any icon files, background images, or other assets referenced by the mini-app or metadata can live in the same app folder.

When packaging a mini-app as a zip, `app.json`, `index.html` or `index.url`, and referenced assets must be at the root of the zip file. Do not wrap them in an extra parent folder.

## Metadata

Each mini-app includes an `app.json` file. This file describes how the mini-app appears inside Layla.

```json
{
  "title": "Example Mini-App",
  "tagline": "A short description for Layla.",
  "description": "Longer text shown when importing or browsing the mini-app.",
  "iconUri": "icon.png",
  "backgroundImgUri": "bg.jpg"
}
```

Common metadata fields:

- `title`: the display name.
- `tagline`: a short summary.
- `description`: longer descriptive text.
- `iconUri`: path to the icon in the app folder.
- `backgroundImgUri`: path to a background or preview image in the app folder.

Prefer square icons for app icons and character portraits, especially when the mini-app includes character selection. Square assets fit card grids, list rows, and import surfaces more predictably.

## HTML Apps

For `index.html` mini-apps, the HTML should be self-contained. That means the final file should include or reference everything needed to run inside the app folder.

This format is useful when:

- The mini-app should work offline.
- The mini-app should not depend on an external host.
- The app is built as a static WebView experience.
- The build output can be bundled into one HTML file.

## URL Apps

For `index.url` mini-apps, the file contains a single URL:

```text
https://example.com/my-layla-mini-app
```

This format is useful when:

- The app is hosted externally.
- The app needs to be updated without re-importing a local HTML file.
- The app is too large or dynamic to package conveniently as a single HTML file.

The hosted page still runs inside Layla's WebView and should follow the same SDK and bridge expectations.

## Background Tasks (task.js)

A mini-app can optionally include a `task.js` file at its root. The Layla host
scans installed mini-app folders for it; when present, the app appears in
Layla's Task Manager, which runs the script periodically in the background and
lets the user trigger it manually and inspect each run's output and logs.

`task.js` does not run in the WebView. The host evaluates it in an isolated
QuickJS runtime with the SDK preinjected as a global `layla` instance, so the
script calls `layla.*` immediately with no imports and no bundling. Top-level
`await` is supported, `console.*` output is buffered into the run's log, and
the script's completion value (its last expression, awaited if it is a
promise) is recorded as the run's output. There is no DOM, `fetch`,
`localStorage`, or timer support, and no state survives between runs — use
`layla.db.executeSql(...)` (the mini-app's private database, shared with the
WebView app) to persist results.

See the "Background Tasks (task.js)" section of the skill for the full
execution model, constraints, and an example script.

## How the SDK Fits In

The SDK wraps the WebView messaging layer so mini-app authors do not need to call `postMessage` or listen for raw message events directly.

At a high level:

- The mini-app calls a method on `LaylaSDK`.
- The SDK sends a bridge message to the React Native host.
- The Layla host handles the request.
- The host sends one or more events back to the WebView.
- The SDK resolves a promise, emits stream events, or reports an error.

The low-level bridge is based on:

- `window.ReactNativeWebView.postMessage(...)` for messages from the WebView to the React Native host.
- WebView message events for responses from the React Native host to the mini-app.

The SDK exposes this as higher-level APIs such as:

- `layla.chat.completions.create(...)`
- `layla.chat.completions.stream(...)`
- `layla.chat.scheduleChatMessage(...)`
- `layla.chat.getScheduledChatMessages(...)`
- `layla.chat.cancelScheduledChatMessage(...)`
- `layla.characters.list(...)`
- `layla.characters.getImage(...)`
- `layla.characters.update(...)`
- `layla.personas.get(...)`
- `layla.tts.getVoices(...)`
- `layla.tts.generateVoice(...)`
- `layla.tts.generateVoiceToFile(...)`
- `layla.tts.stopSpeaking(...)`
- `layla.backgroundAudio.start(...)`
- `layla.backgroundAudio.pause()` / `resume()` / `skip()` / `stop()`
- `layla.images.generateImage(...)`

## Runtime Expectations

Mini-apps should be treated as browser apps running in a WebView.

- No API key is required.
- No direct network LLM endpoint is required.
- The Layla host chooses the active model.
- SDK calls require the Layla WebView bridge.
- Long-running generation flows should support cancellation.
- Chat responses should usually be streamed into the UI.

When a mini-app runs in a normal browser during development, the real Layla bridge is not available. Use the SDK mock for local development when SDK calls need to work outside Layla.

```ts
import { installLaylaMock } from '@layla-network/sdk';

if (import.meta.env.DEV) {
  installLaylaMock({ debug: true });
}
```

## Importing a Mini-App

The import flow adds a mini-app folder to Layla and registers its metadata.

Typical import checklist:

- Include `app.json`.
- Include either `index.html` or `index.url`.
- Include any referenced icons or assets.
- Include `task.js` at the root when the mini-app ships a background task.
- Put `app.json`, `index.html` or `index.url`, `task.js` when used, and referenced assets at the root of the zip file when distributing a zipped mini-app.
- Make sure asset paths match the files in the mini-app folder.
- Make sure `index.url` contains only the URL when using a hosted app.
- Make sure `index.html` is self-contained when using a packaged app.
- Confirm the app metadata appears correctly after import.
- Launch the mini-app inside Layla and verify SDK calls connect to the host.

## Troubleshooting

- If SDK calls fail with `LaylaBridgeUnavailableError`, the app is likely running outside Layla or before the bridge is available.
- If assets do not render, check paths relative to the mini-app folder.
- If a URL app does not load, check the single-line contents of `index.url`.
- If metadata does not appear, validate `app.json`.

## API Surface Compatibility

This SDK is open source, but it is not recommended to modify the public API surface. The SDK protocol and API methods must stay in sync with the Layla host side, which is not open source.

If you need new SDK behavior, prefer opening an issue or coordinating a host-side change rather than changing method names, request shapes, response shapes, or exported protocol types locally.
