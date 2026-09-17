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
- **On the host** — `npm run build` produces an importable mini-app in `dist/`.
  Its `index.html` is self-contained (via `vite-plugin-singlefile`), while
  `app.json`, `icon.png`, and `thumbnail.png` provide the Layla metadata and
  artwork. Zip the *contents* of `dist/` at the archive root and import it into
  Layla. The same app then drives the **real** bridge, so it verifies the host's
  protocol implementation.

The banner in the toolbar shows which environment was detected: *Browser mock*,
*Native host bridge*, or *No bridge detected*.

## Using it

- **Run all** runs every check except the *heavy* ones. Tick **include heavy** to
  also run the chat interfaces, tool calling, TTS synthesis/playback, image
  generation, music generation, the microphone, and the background-audio
  player.
- Each check (and each group) has its own **Run** button.
- **Rerun failures** re-runs only what failed.
- Each check has an expandable **Log** section containing plain text. Checks can
  write their own multiline diagnostic format; checks without custom log output
  show their result detail there instead.

Most checks have a 45s watchdog, so a missing or broken endpoint fails loudly
instead of hanging. On-device generation endpoints (TTS synthesis, image
generation, music generation) are designed to run for a long time, so they are
exempt from the watchdog and run until the host responds.

The Chat group also sends the same user message in two sequential completions
with unrelated system prompts. Each prompt requires a different marker word,
which verifies that the host replaces the active system prompt between calls.
Its log preserves both complete responses for debugging.

## The tool-calling check

`tool calling (tools -> tool_calls -> result -> answer)` runs a full tool loop
and is *heavy*. It offers one tool that returns a code the model cannot know or
guess, runs whatever call the model asks for, feeds the result back as a `tool`
message, and fails unless the final answer carries that code. So it proves the
whole path end to end: `tools` reaching the model, the host's `<tool_call>`
markup being read back into `message.tool_calls`, `finish_reason` switching to
`tool_calls`, the call's id surviving the round trip, and the model actually
using what the tool returned.

It **skips** on a host older than **v7.5.0**, which is where tool calling
starts — older hosts drop `tools` before the request leaves the SDK. The
browser mock reports `v7.5.0` and stands in for a model that uses its tools, so
the check runs there too.

It is exempt from the watchdog: it takes at least two full generations, plus
the prompt reprocessing between them, which on-device runs well past 45s. Its
log records every round — `finish_reason`, the prose, and each call with its
arguments and id — so a model that answers without calling the tool, or calls
it with the wrong arguments, is visible rather than just a red dot.

## The Layla Cloud check

`login (access token)` asks the host for the access token of the Layla Cloud
account signed in on the device. It passes when the host returns a non-empty
token, and reports *skip* when it returns `null` — no account is signed in, or
the user declined the login — since that is a valid answer rather than a broken
endpoint. The log records the token's length and first few characters only,
never the token itself: it is a live bearer credential.

It is *safe* (it runs with **Run all**), but exempt from the watchdog, because
the host may put an interactive sign-in in front of the user, which easily
outlasts 45s. The browser mock answers with a placeholder token, so the check is
green there without a real account.

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

- *Heavy* checks include chat interfaces, tool calling, and operations with real
  host side effects (audio playback, image generation, music generation,
  microphone access). Leave them off unless you're testing them.
- Write checks are labelled and use `[diagnostics]` content. The scheduled-chat
  and scheduled-notification checks cancel what they create; the notification
  probe uses the mini-app's bundled `icon.png` and verifies it disappears from
  the pending list.
