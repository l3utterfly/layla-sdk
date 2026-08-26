# Layla SDK Diagnostics

A mini-app that exercises **every public `@layla-network/sdk` endpoint** plus the
**per-lane concurrency** behaviour, and reports pass / fail / skip for each. It's
the one-shot sanity test we keep updated as the SDK changes.

It imports the SDK straight from the sibling source (`../../../src/index`), like
the other examples.

## Two ways to run

- **In a browser (`npm run dev`)** — there's no native host, so `main.tsx`
  installs the browser mock, which answers every endpoint. The whole suite goes
  green with no host involved. Good for checking the SDK and this app itself.
- **On the host** — `npm run build` produces a single self-contained
  `dist/index.html` (via `vite-plugin-singlefile`). Copy that one file to the
  host and load it in the Layla WebView. The same App now drives the **real**
  bridge, so it verifies the host's protocol implementation.

The banner in the toolbar shows which environment was detected: *Browser mock*,
*Native host bridge*, or *No bridge detected*.

## Using it

- **Run all** runs every check except the *heavy* ones. Tick **include heavy** to
  also run the chat interfaces, TTS synthesis/playback, image generation, music
  generation, the microphone, and the background-audio player.
- Each check (and each group) has its own **Run** button.
- **Rerun failures** re-runs only what failed.

Most checks have a 45s watchdog, so a missing or broken endpoint fails loudly
instead of hanging. On-device generation endpoints (TTS synthesis, image
generation, music generation) are designed to run for a long time, so they are
exempt from the watchdog and run until the host responds.

## Concurrency checks

The **Concurrency** group covers the per-lane bridge change:

- **cross-lane** — a fast `db.executeSql` fired alongside a slow chat stream must
  finish first (it isn't stuck behind the generation in a global queue).
- **fan-out** — one read per surface fired at once; wall time should be far below
  their sum.
- **same-lane** — two simultaneous chat generations each return their own answer
  (no cross-talk).
- **error isolation** — a failing request must not take down a concurrent healthy
  one. This one **requires the host to echo request ids**: if it fails on the
  host (the healthy request also dies), the host isn't attributing errors by id
  yet. It reports *skip* under the browser mock, which is id-less by design.

## Notes for the host run

- *Heavy* checks include chat interfaces and operations with real host side
  effects (audio playback, image generation, music generation, microphone
  access). Leave them off unless you're testing them.
- Write checks are labelled and use `[diagnostics]` content; the scheduling check
  cancels what it creates.
