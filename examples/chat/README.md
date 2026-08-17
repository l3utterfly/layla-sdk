# Layla chat example

A small React and Vite mini-app demonstrating Layla SDK streaming chat,
OpenAI-shaped image inputs, voice chatting with the speech-to-text (STT) and
text-to-speech (TTS) APIs, and a persistent transcript stored in the mini-app's
private database.

Users can attach one PNG, JPEG, GIF, or WebP image, optionally add text, preview
or remove the attachment, and send it with the message. The completion request
uses an `image_url` content part containing a base64 data URL; the SDK translates
that part to Layla's native `image_base64` field.

## Voice chatting

The composer's microphone button calls `layla.stt.startListening()` and listens
for the `speechRecognized` event. Recognised speech drops into the composer so
you can review it before sending. Every assistant reply also has a **Play**
button that speaks it aloud with `layla.tts.generateVoice(...)`, using the voice
chosen in the header voice picker.

Toggle **Voice** in the header for a hands-free conversation loop: the app
listens, auto-sends the recognised speech, speaks the reply, and starts
listening again. Turning Voice off (or tapping the "Speaking" pill) stops
playback via `layla.tts.stopSpeaking()`.

In development the Layla mock host answers `startListening()` and emits a canned
transcript shortly after, so the voice flow can be exercised entirely in the
browser.

## Persistent history

The app keeps its own transcript in the mini-app's private sqlite database with
the `layla.db` surface. On launch it runs
`CREATE TABLE IF NOT EXISTS chat_messages (...)`, then loads the stored rows back
into the conversation. Every user and assistant message is appended with a
parameterised `INSERT`, and the header **Clear** button runs a `DELETE` to wipe
the transcript. This is separate from `layla.chat.saveChatMessage(...)`, which
writes to Layla's native chat history.

The browser mock has no real sqlite, so `main.tsx` passes an `executeSql` handler
to `installLaylaMock(...)` that backs the four statements this app issues with a
small `localStorage` store. That makes the load-on-reload flow work end to end in
the browser; inside Layla the same calls run against the real on-device database.

```bash
npm install
npm run dev
```

Development mode installs the Layla mock host. Use `npm run build` to create the
self-contained mini-app bundle.
