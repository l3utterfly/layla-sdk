// Run after npm run build: node --test tests/image-generation.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  LaylaError,
  LaylaSDK,
  installLaylaMock,
} from '../dist/index.js';

globalThis.window = new EventTarget();
let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
  delete window.ReactNativeWebView;
});

const reply = (request, event, data) => window.dispatchEvent(new MessageEvent('message', {
  data: JSON.stringify({ id: request.id, event, data }),
}));
const references = ['data:image/png;base64,Zmlyc3Q=', 'data:image/jpeg;base64,c2Vjb25k'];

test('forwards references alongside img2img, model selection and progress', { timeout: 1000 }, async () => {
  const sent = [];
  const progress = [];
  window.ReactNativeWebView = {
    postMessage(raw) {
      const request = JSON.parse(raw);
      sent.push(request);
      // Even a host that responds synchronously must reach the registered callbacks.
      reply(request, 'on_generate_image_progress', { status: 'Generating', steps: 1, total_steps: 4 });
      reply(request, 'on_generate_image_response', { image_data_base64: 'data:image/png;base64,cmVzdWx0' });
    },
  };
  const result = await new LaylaSDK().images.generateImage(
    'Edit the references', (...args) => progress.push(args),
    'data:image/png;base64,YmFzZQ==', 'reference-model',
    { referenceImages: references, signal: new AbortController().signal },
  );
  assert.equal(sent[0].cmd, 'generate_image');
  assert.deepEqual(sent[0].data, {
    prompt: 'Edit the references', img2img_base64: 'data:image/png;base64,YmFzZQ==',
    model_id: 'reference-model', reference_images: references,
  });
  assert.deepEqual(progress, [['Generating', 1, 4]]);
  assert.equal(result, 'data:image/png;base64,cmVzdWx0');
});

test('preserves calls without references and forwards an empty array unchanged', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage(raw) {
    const request = JSON.parse(raw);
    sent.push(request);
    reply(request, 'on_generate_image_response', { image_data_base64: null });
  } };
  const images = new LaylaSDK().images;
  assert.equal(await images.generateImage('Draw', () => {}), null);
  assert.deepEqual(sent[0].data, { prompt: 'Draw' });
  await images.generateImage('Draw', () => {}, undefined, undefined, { referenceImages: [] });
  assert.deepEqual(sent[1].data, { prompt: 'Draw', reference_images: [] });
});

test('rejects an unsupported-model error and releases the lane for the next request', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage(raw) { sent.push(JSON.parse(raw)); } };
  const images = new LaylaSDK().images;
  const rejected = assert.rejects(
    images.generateImage('Edit', () => {}, undefined, 'unsupported', { referenceImages: references }),
    (error) => error instanceof LaylaError && error.message === 'Model does not support reference images.',
  );
  const next = images.generateImage('Draw', () => {});
  assert.equal(sent.length, 1);
  reply(sent[0], 'on_error', { message: 'Model does not support reference images.' });
  await rejected;
  assert.equal(sent.length, 2);
  reply(sent[1], 'on_generate_image_response', { image_data_base64: 'result' });
  assert.equal(await next, 'result');
});

test('rejects when the native bridge is unavailable', { timeout: 1000 }, async () => {
  await assert.rejects(
    new LaylaSDK().images.generateImage('Edit', () => {}, undefined, undefined, { referenceImages: references }),
    (error) => error instanceof LaylaBridgeUnavailableError,
  );
});

test('an already-aborted reference request rejects without posting', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(raw) };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new LaylaSDK().images.generateImage('Edit', () => {}, undefined, undefined, {
      referenceImages: references, signal: controller.signal,
    }),
    (error) => error instanceof LaylaAbortError,
  );
  assert.deepEqual(sent, []);
});

test('aborting rejects and suppresses subsequent progress while awaiting the terminal response', { timeout: 1000 }, async () => {
  const sent = [];
  const progress = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
  const controller = new AbortController();
  const rejected = assert.rejects(
    new LaylaSDK().images.generateImage('Edit', (...args) => progress.push(args), undefined, undefined, {
      referenceImages: references, signal: controller.signal,
    }),
    (error) => error instanceof LaylaAbortError,
  );
  controller.abort();
  await rejected;
  reply(sent[0], 'on_generate_image_progress', { status: 'Late', steps: 2, total_steps: 4 });
  reply(sent[0], 'on_generate_image_response', { image_data_base64: 'late' });
  assert.deepEqual(progress, []);
});

test('the browser mock accepts reference requests without simulating model capabilities', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const result = await new LaylaSDK().images.generateImage('Edit', () => {}, undefined, undefined, {
    referenceImages: references,
  });
  assert.equal(typeof result, 'string');
});
