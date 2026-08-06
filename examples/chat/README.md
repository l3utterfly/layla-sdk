# Layla chat example

A small React and Vite mini-app demonstrating Layla SDK streaming chat and
OpenAI-shaped image inputs.

Users can attach one PNG, JPEG, GIF, or WebP image, optionally add text, preview
or remove the attachment, and send it with the message. The completion request
uses an `image_url` content part containing a base64 data URL; the SDK translates
that part to Layla's native `image_base64` field.

```bash
npm install
npm run dev
```

Development mode installs the Layla mock host. Use `npm run build` to create the
self-contained mini-app bundle.
