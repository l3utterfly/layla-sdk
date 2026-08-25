# Examples

This folder contains small Layla mini-app examples. Each one demonstrates a different SDK usage pattern.

## `chat`

A basic chat UI demonstrating OpenAI-compatible API usage.

Use this example to see the smallest practical chat integration: creating a `LaylaSDK` client, sending chat messages, streaming responses into the UI, and stopping an active generation.

## `chess`

A chess mini-app demonstrating character integration, external libraries, and website-hosted output.

Use this example to see how a mini-app can obtain character information, fetch and display character images, use external libraries such as Stockfish, and host the result on a website.

## `tarrot`

A tarot reading mini-app demonstrating in-context chat and bundling assets into one HTML file.

Use this example to see how a mini-app can keep local interaction context, pass that context into chat prompts, and package a richer visual experience with bundled assets.

## `swipe`

A swipe-style character generator demonstrating image generation and creating new characters.

Use this example to see how a mini-app can generate images, build Character Card V2 data, and save newly created characters back into Layla.

## `diagnostics`

A test harness that exercises **every** public SDK endpoint plus the per-lane concurrency behaviour, reporting pass / fail / skip for each.

Use this as the one-shot sanity check when the SDK changes: run it in a browser against the mock (`npm run dev`), or `npm run build` a single-file `dist/index.html` and copy it to the host to verify the real protocol implementation. Keep it updated as new endpoints are added.
