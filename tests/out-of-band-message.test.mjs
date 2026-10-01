// Run after npm run build: node --test tests/out-of-band-message.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  LaylaAbortError,
  LaylaError,
  LaylaSDK,
  installLaylaMock,
} from '../dist/index.js';

// One window for the whole file: the bridge binds its `message` listener to the
// first one it sees, so a per-test window would leave later tests unheard.
globalThis.window = new EventTarget();

let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

function recordWire() {
  const messages = [];
  const host = window.ReactNativeWebView;
  const post = host.postMessage.bind(host);
  host.postMessage = raw => {
    messages.push(JSON.parse(raw));
    post(raw);
  };
  return messages;
}

const schema = {
  type: 'object',
  properties: {
    send: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['send'],
};

test('sends the contextual command and resolves with the reply text', async () => {
  const requests = [];
  mock = installLaylaMock({
    latencyMs: 0,
    outOfBandMessage: request => {
      requests.push(request);
      return 'yes';
    },
  });
  const wire = recordWire();

  const reply = await new LaylaSDK().contextual.sendOutOfBandMessage(
    'Should the character send a picture now? Answer yes or no.',
    { imageBase64: 'data:image/png;base64,aW1n', jsonSchema: schema },
  );

  assert.equal(reply, 'yes');
  const expected = {
    message: 'Should the character send a picture now? Answer yes or no.',
    image_base64: 'data:image/png;base64,aW1n',
    json_schema: schema,
  };
  assert.deepEqual(requests, [expected]);
  assert.deepEqual(
    wire.map(({ cmd, data }) => ({ cmd, data })),
    [{ cmd: 'send_out_of_band_message', data: expected }],
  );
});

test('omitted options stay off the wire', async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const wire = recordWire();

  const reply = await new LaylaSDK().contextual.sendOutOfBandMessage('Hello?');

  assert.match(reply, /Hello\?/);
  assert.deepEqual(wire[0].data, { message: 'Hello?' });
});

test('the default mock reply satisfies a sent JSON Schema', async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const reply = await new LaylaSDK().contextual.sendOutOfBandMessage(
    'Decide.',
    { jsonSchema: schema },
  );
  assert.deepEqual(JSON.parse(reply), { send: false });
});

test('an empty reply rejects with LaylaError', async () => {
  mock = installLaylaMock({ latencyMs: 0, outOfBandMessage: () => '' });
  await assert.rejects(
    new LaylaSDK().contextual.sendOutOfBandMessage('Anything?'),
    error => error instanceof LaylaError && !(error instanceof LaylaAbortError),
  );
});

test('aborting sends a cancel for this request only, leaving a chat stream running', async () => {
  mock = installLaylaMock({ latencyMs: 30, tokenDelayMs: 1 });
  const wire = recordWire();
  const layla = new LaylaSDK();

  const chat = layla.chat.completions.create({
    messages: [{ role: 'user', content: 'Hi' }],
  });
  const controller = new AbortController();
  const pending = layla.contextual.sendOutOfBandMessage('Side question', {
    signal: controller.signal,
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();

  await assert.rejects(pending, error => error instanceof LaylaAbortError);
  const request = wire.find(m => m.cmd === 'send_out_of_band_message');
  const cancel = wire.find(m => m.cmd === 'cancel');
  assert.ok(cancel, 'a cancel was posted');
  assert.equal(cancel.id, request.id);

  const completion = await chat;
  assert.match(completion.choices[0].message.content, /Hi/);
});
