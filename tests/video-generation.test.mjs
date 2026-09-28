// Run after npm run build: node --test tests/video-generation.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  LaylaAbortError,
  LaylaSDK,
  NeoDragon,
  installLaylaMock,
} from '../dist/index.js';

// The bridge keeps one window listener for the process, so reuse one window.
globalThis.window = new EventTarget();

let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

test('the client exposes NeoDragon and sends the namespaced command', async () => {
  const requests = [];
  const progress = [];
  const wireMessages = [];
  mock = installLaylaMock({
    latencyMs: 0,
    neodragonGenerateVideo: (request, reportProgress) => {
      requests.push(request);
      reportProgress({
        stage: 'sampling',
        current: 2,
        total: 4,
        fraction: 0.5,
      });
      return {
        video_data_base64: 'data:video/mp4;base64,bW9jay12aWRlbw==',
        seed: request.seed ?? 99,
        width: 512,
        height: 320,
        frame_count: 49,
        fps: request.fps ?? 24,
        duration_ms: 2042,
        generation_time_ms: 750,
      };
    },
  });
  const host = window.ReactNativeWebView;
  const post = host.postMessage.bind(host);
  host.postMessage = (raw) => {
    wireMessages.push(JSON.parse(raw));
    post(raw);
  };

  const layla = new LaylaSDK();
  assert.ok(layla.neodragon instanceof NeoDragon);

  const result = await layla.neodragon.generateVideo(
    'data:image/png;base64,c291cmNl',
    'A gentle breeze moves the leaves',
    {
      seed: 0,
      upscale: false,
      fps: 12,
      cinematicPrompt: false,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      onProgress: (event) => progress.push(event),
    },
  );

  assert.deepEqual(requests, [
    {
      image_data_base64: 'data:image/png;base64,c291cmNl',
      prompt: 'A gentle breeze moves the leaves',
      seed: 0,
      upscale: false,
      fps: 12,
      cinematic_prompt: false,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    },
  ]);
  assert.equal(wireMessages[0]?.cmd, 'neodragon_generate_video');
  assert.deepEqual(progress, [
    { stage: 'sampling', current: 2, total: 4, fraction: 0.5 },
  ]);
  assert.equal(result.video_data_base64.startsWith('data:video/mp4;base64,'), true);
  assert.equal(result.seed, 0);
  assert.equal(result.fps, 12);
});

test('the default mock reports progress and returns MP4 metadata', async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const progress = [];

  const result = await new NeoDragon().generateVideo(
    'data:image/jpeg;base64,c291cmNl',
    'Slow camera push-in',
    { upscale: false, fps: 30, onProgress: (event) => progress.push(event) },
  );

  assert.deepEqual(progress.map(({ stage }) => stage), [
    'loading',
    'text',
    'sampling',
    'decoding',
  ]);
  assert.equal(result.width, 512);
  assert.equal(result.height, 320);
  assert.equal(result.fps, 30);
  assert.match(result.video_data_base64, /^data:video\/mp4;base64,/);
});

test('an aborted video generation rejects with LaylaAbortError', async () => {
  mock = installLaylaMock({ latencyMs: 20 });
  const controller = new AbortController();
  const pending = new NeoDragon().generateVideo(
    'data:image/png;base64,c291cmNl',
    'Animate this image',
    { signal: controller.signal },
  );

  controller.abort();

  await assert.rejects(pending, (error) => error instanceof LaylaAbortError);
});
