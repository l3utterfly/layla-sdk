# Layla Reader

Layla Reader is a Layla mini-app that turns TXT, PDF, and EPUB documents into
an on-device narration queue. It extracts the document text in the WebView,
splits it into passages, generates each passage with Layla's configured
text-to-speech voice, and plays the saved clips through Layla's background
audio player.

## Features

- Imports TXT, PDF, and EPUB files from the device.
- Reports extraction progress by PDF page or EPUB section.
- Splits extracted text into paragraph-sized passages, with long paragraphs
  divided at sentence boundaries.
- Pre-generates and saves narration one passage at a time using
  `layla.tts.generateVoiceToFile(...)`.
- Queues completed clips with `layla.backgroundAudio` and provides play,
  pause, previous, next, and passage-selection controls.
- Includes sample books and a browser mock for local UI development.
- Builds as a self-contained Layla mini-app package that works offline.

Document text is parsed in the app and held in memory. The mini-app does not
upload imported books to an external service.

## Develop locally

Use Node.js 24 and run the example from this repository checkout:

```bash
cd examples/ebook-reader
npm ci
npm run dev
```

Open the URL printed by Vite, normally <http://localhost:5173>. Development
mode installs the Layla SDK browser mock before the app starts, so extraction,
the narration progress UI, and playback controls can be exercised without the
native Layla WebView. Narration and playback are simulated in this mode.

The example imports the SDK source from this repository rather than an
installed npm package. Real TTS generation and background audio therefore need
to be tested by importing a production build into a compatible version of
Layla.

## Build and check

```bash
npm run lint
npm run build
```

The production build is written to `dist/`. `vite-plugin-singlefile` inlines
the application code and styles into `index.html`; Vite also copies
`app.json`, `icon.jpg`, and `bg.jpg` from `public/`. These files must stay at
the root of the archive:

```text
ebook-reader.zip
├── app.json
├── bg.jpg
├── icon.jpg
└── index.html
```

Import the zip through Layla's mini-app import flow. Do not place the files
inside an extra parent directory when creating the archive.

## Releases

The `Release ebook reader` GitHub Actions workflow runs when files under
`examples/ebook-reader/` are pushed to `main`. It:

1. Reads the version from `package.json`.
2. Skips the job if the corresponding release already exists.
3. Installs dependencies and builds the production mini-app.
4. Packages the contents of `dist/` as `ebook-reader.zip`.
5. Creates the tag and release `ebook-reader-v<version>` with generated notes.

Bump the version in both `package.json` and `package-lock.json` before merging
the next release. A change that keeps an already released version is skipped
until the version is updated.

## Project layout

```text
public/
  app.json          Layla mini-app metadata
  bg.jpg            Import/background artwork
  icon.jpg          Mini-app icon
src/
  lib/extract.ts    TXT, PDF, and EPUB text extraction
  lib/chunk.ts      Passage splitting and duration estimates
  App.tsx           Narration pipeline and background-audio controls
  main.tsx          App entry point and development mock setup
vite.config.ts      Single-file production build configuration
```
