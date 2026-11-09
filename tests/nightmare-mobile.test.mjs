// Run after npm run build: node --test tests/nightmare-mobile.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  LaylaSDK,
  NightmareMobile,
  LaylaError,
  LaylaAbortError,
  LaylaBridgeUnavailableError,
  installLaylaMock,
} from '../dist/index.js';

globalThis.window = new EventTarget();
let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
  delete window.ReactNativeWebView;
});
const reply = (request, event, data) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({ id: request.id, event, data }),
    }),
  );
const result = {
  model_id: 'chosen',
  video_data_base64: 'data:video/mp4;base64,bXA0',
  seed: '18446744073709551615',
  width: 1601,
  height: 901,
  frame_count: 200,
  fps: 30,
  duration_ms: 6667,
  generation_time_ms: 10000,
};
const image = 'data:image/png;base64,aW1hZ2U=';

test(
  'exposes the resource and lists downloaded and unavailable models',
  { timeout: 2000 },
  async () => {
    mock = installLaylaMock({ latencyMs: 0 });
    const client = new LaylaSDK();
    assert.ok(client.nightmareMobile instanceof NightmareMobile);
    const models = await client.nightmareMobile.getModels();
    assert.ok(models.some((model) => model.downloaded));
    assert.ok(models.some((model) => !model.downloaded));
    assert.deepEqual(models[0].fps_options, [8, 12, 16, 24]);
  },
);

test(
  'maps every public option to its wire field and preserves progress and the string seed',
  { timeout: 2000 },
  async () => {
    const sent = [];
    const progress = [];
    window.ReactNativeWebView = {
      postMessage(raw) {
        const request = JSON.parse(raw);
        sent.push(request);
        reply(request, 'on_nightmaremobile_generate_video_progress', {
          stage: 'sampling',
          pass: 2,
          total_passes: 2,
          step: 1,
          total_steps: 4,
        });
        reply(request, 'on_nightmaremobile_generate_video_response', result);
      },
    };
    const generated = await new NightmareMobile().generateVideo('chosen', 'Waves roll in', {
      negativePrompt: '',
      width: 1601,
      height: 901,
      frames: 200,
      fps: 30,
      seed: result.seed,
      imageDataBase64: image,
      endImageDataBase64: image,
      denoiseStrength: 0,
      onProgress: (value) => progress.push(value),
      signal: new AbortController().signal,
    });
    assert.equal(sent[0].cmd, 'nightmaremobile_generate_video');
    assert.deepEqual(sent[0].data, {
      model_id: 'chosen',
      prompt: 'Waves roll in',
      negative_prompt: '',
      width: 1601,
      height: 901,
      frames: 200,
      fps: 30,
      seed: result.seed,
      image_data_base64: image,
      end_image_data_base64: image,
      denoise_strength: 0,
    });
    assert.deepEqual(progress, [
      { stage: 'sampling', pass: 2, total_passes: 2, step: 1, total_steps: 4 },
    ]);
    assert.deepEqual(generated, result);
  },
);

test(
  'omits unset controls and does not forward advanced or removed options',
  { timeout: 2000 },
  async () => {
    const sent = [];
    window.ReactNativeWebView = {
      postMessage(raw) {
        const request = JSON.parse(raw);
        sent.push(request);
        reply(request, 'on_nightmaremobile_generate_video_response', result);
      },
    };
    await new NightmareMobile().generateVideo('chosen', 'Waves');
    await new NightmareMobile().generateVideo('chosen', 'Waves', {
      seed: 0,
      duration: 2,
      aspect_ratio: '16:9',
      loras: [],
      sampling: { steps: 1 },
    });
    assert.deepEqual(sent[0].data, { model_id: 'chosen', prompt: 'Waves' });
    assert.deepEqual(sent[1].data, { model_id: 'chosen', prompt: 'Waves', seed: 0 });
  },
);

test(
  'does not enforce advisory capabilities in either the SDK or browser mock',
  { timeout: 2000 },
  async () => {
    mock = installLaylaMock({ latencyMs: 0 });
    const progress = [];
    const generated = await new NightmareMobile().generateVideo('wan22_ti2v_turbo', 'Waves', {
      width: 4097,
      height: 2049,
      frames: 2,
      fps: 90,
      endImageDataBase64: image,
      onProgress: (value) => progress.push(value),
    });
    assert.equal(generated.width, 4097);
    assert.equal(generated.frame_count, 2);
    assert.equal(generated.fps, 90);
    assert.deepEqual(
      progress.map(({ stage }) => stage),
      ['loading', 'preparing', 'sampling', 'decoding', 'encoding', 'saving'],
    );
  },
);

test(
  'supports a custom model list and custom generator with correlated errors',
  { timeout: 2000 },
  async () => {
    const calls = [];
    mock = installLaylaMock({
      latencyMs: 0,
      nightmareMobileModels: [],
      nightmareMobileGenerateVideo: (request, reportProgress) => {
        calls.push(request);
        if (request.prompt === 'fail') throw new Error('engine failed');
        reportProgress({ stage: 'encoding', frame: 1, total_frames: 2 });
        return result;
      },
    });
    const resource = new NightmareMobile();
    assert.deepEqual(await resource.getModels(), []);
    await assert.rejects(
      resource.generateVideo('chosen', 'fail'),
      (error) => error instanceof LaylaError && error.message === 'engine failed',
    );
    assert.deepEqual(await resource.generateVideo('chosen', 'Waves'), result);
    assert.equal(calls.length, 2);
  },
);

test('rejects unavailable models in the default mock', { timeout: 2000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  await assert.rejects(
    new NightmareMobile().generateVideo('wan22_i2v_a14b', 'Waves'),
    (error) => error instanceof LaylaError && /not downloaded/.test(error.message),
  );
});

test('lists models independently while generation is in flight', { timeout: 2000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
  const resource = new NightmareMobile();
  const video = resource.generateVideo('chosen', 'Waves');
  const models = resource.getModels();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].data, null);
  reply(sent[1], 'on_nightmaremobile_get_models_response', []);
  assert.deepEqual(await models, []);
  reply(sent[0], 'on_nightmaremobile_generate_video_response', result);
  assert.deepEqual(await video, result);
});

test(
  'serializes generations and routes host errors only to their request',
  { timeout: 2000 },
  async () => {
    const sent = [];
    window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    const resource = new NightmareMobile();
    const failed = assert.rejects(resource.generateVideo('chosen', 'fail'), LaylaError);
    const next = resource.generateVideo('chosen', 'next');
    const models = resource.getModels();
    assert.equal(sent.length, 2);
    reply(sent[0], 'on_error', { message: 'generation failed' });
    await failed;
    assert.equal(sent.length, 3);
    reply(sent[1], 'on_nightmaremobile_get_models_response', []);
    reply(sent[2], 'on_nightmaremobile_generate_video_response', result);
    assert.deepEqual(await models, []);
    assert.deepEqual(await next, result);
  },
);

test(
  'rejects an already-aborted generation and model listing without posting',
  { timeout: 2000 },
  async () => {
    const sent = [];
    window.ReactNativeWebView = { postMessage: (raw) => sent.push(raw) };
    const controller = new AbortController();
    controller.abort();
    const resource = new NightmareMobile();
    await assert.rejects(
      resource.generateVideo('chosen', 'Waves', { signal: controller.signal }),
      LaylaAbortError,
    );
    await assert.rejects(resource.getModels({ signal: controller.signal }), LaylaAbortError);
    assert.deepEqual(sent, []);
  },
);

test(
  'local abort suppresses progress and holds the lane until native completion',
  { timeout: 2000 },
  async () => {
    const sent = [];
    const progress = [];
    window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    const resource = new NightmareMobile();
    const controller = new AbortController();
    const aborted = assert.rejects(
      resource.generateVideo('chosen', 'Waves', {
        signal: controller.signal,
        onProgress: (value) => progress.push(value),
      }),
      LaylaAbortError,
    );
    const next = resource.generateVideo('chosen', 'Next');
    controller.abort();
    await aborted;
    assert.equal(sent.length, 1);
    reply(sent[0], 'on_nightmaremobile_generate_video_progress', { stage: 'saving' });
    reply(sent[0], 'on_nightmaremobile_generate_video_response', result);
    assert.deepEqual(progress, []);
    assert.equal(sent.length, 2);
    reply(sent[1], 'on_nightmaremobile_generate_video_response', result);
    await next;
  },
);

test('aborting a queued request removes it without posting', { timeout: 2000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
  const resource = new NightmareMobile();
  const first = resource.generateVideo('chosen', 'First');
  const controller = new AbortController();
  const aborted = assert.rejects(
    resource.generateVideo('chosen', 'Queued', { signal: controller.signal }),
    LaylaAbortError,
  );
  controller.abort();
  await aborted;
  reply(sent[0], 'on_nightmaremobile_generate_video_response', result);
  await first;
  assert.equal(sent.length, 1);
});

test('throwing progress callbacks do not fail generation', { timeout: 2000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  assert.ok(
    await new NightmareMobile().generateVideo('wan22_ti2v_turbo', 'Waves', {
      onProgress() {
        throw new Error('consumer failed');
      },
    }),
  );
});

test(
  'missing bridges and simulated model-list errors reject with SDK errors',
  { timeout: 2000 },
  async () => {
    const resource = new NightmareMobile();
    await assert.rejects(resource.generateVideo('chosen', 'Waves'), LaylaBridgeUnavailableError);
    await assert.rejects(resource.getModels(), LaylaBridgeUnavailableError);
    mock = installLaylaMock({ latencyMs: 0, errorRate: 1 });
    await assert.rejects(resource.getModels(), LaylaError);
    await assert.rejects(resource.generateVideo('chosen', 'Waves'), LaylaError);
  },
);
