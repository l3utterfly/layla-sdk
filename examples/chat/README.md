# Layla chat example

A small React and Vite mini-app demonstrating Layla SDK streaming chat,
OpenAI-shaped image inputs, and voice chatting with the speech-to-text (STT) and
text-to-speech (TTS) APIs.

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

```bash
npm install
npm run dev
```

Development mode installs the Layla mock host. Use `npm run build` to create the
self-contained mini-app bundle.
