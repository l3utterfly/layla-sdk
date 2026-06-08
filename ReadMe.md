# Layla SDK

<table>
  <tr>
    <td>
      <img src="assets/layla.png" alt="Layla butterfly logo" width="160">
    </td>
    <td>
      The Layla SDK project provides the public TypeScript SDK for building custom Layla mini-apps. Mini-apps run inside Layla's WebView and can use <code>@layla-network/sdk</code> to talk to the Layla host through an OpenAI-shaped API for chat, streaming responses, characters, character images, image generation, and local development mocks.
    </td>
  </tr>
</table>

## Project Links

- [Docs](docs/) - mini-app packaging guidance and the SDK API reference.
- [SDK source](src/) - the TypeScript source for `@layla-network/sdk`.
- [Examples](examples/) - sample Layla mini-apps showing chat, chess, tarot, and character generation workflows.
- [Agent skill](agents/layla-sdk/) - a packaged skill that helps other coding agents understand how to create Layla mini-apps with this SDK.

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

## Releases

Each release contains:

1. SDK source code as a zip file. The SDK package is also published to npm automatically.
2. Example mini-apps as a zip file that can be imported into Layla directly.
3. An agent skills zip file that can be imported into other agents so they can create Layla mini-apps for you.

## Learn More

- Read the [mini-apps overview](docs/mini-apps-overview.md) to understand app packaging, metadata, and the Layla WebView runtime.
- Read the [SDK API reference](docs/sdk-api.md) for imports, chat completions, streaming, characters, image generation, abort handling, and errors.
- Browse the [examples guide](examples/ReadMe.md) to choose a starting mini-app.
