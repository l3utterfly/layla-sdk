// Run after npm run build: node --test tests/acestep-models.test.mjs
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { AceStep, installLaylaMock } from '../dist/index.js';

let mock;
beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
  delete globalThis.window;
});

test('lists models and forwards the selected model to every generation API', async () => {
  const models = [
    { modelId: 'builtin-ready', ready_for_use: true },
    { modelId: 'builtin-missing', ready_for_use: false },
    { modelId: 'imported-ready', ready_for_use: true },
  ];
  mock = installLaylaMock({ latencyMs: 0, aceStepModels: models });

  assert.deepEqual(await new AceStep().getModels(), models);
  mock.uninstall();

  const seen = [];
  const capture = request => {
    seen.push(request.model_id);
    return request;
  };

  mock = installLaylaMock({
    latencyMs: 0,
    aceStepGenerate: request => {
      capture(request);
      return { audio_data_base64: 'data:audio/wav;base64,UklGRg==' };
    },
    aceStepLm: request => {
      capture(request);
      return { requests: [request.request] };
    },
    aceStepSynth: request => {
      capture(request);
      return {
        audio_data_base64: 'data:audio/wav;base64,UklGRg==',
        seed: 1,
        sample_rate: 48000,
        num_samples: 48000,
        duration_seconds: 1,
        request: request.request,
      };
    },
    aceStepUnderstand: request => {
      capture(request);
      return {
        request: { caption: 'analyzed' },
        latents_base64: null,
        latent_frames: 0,
        duration_seconds: 1,
      };
    },
    aceStepVae: request => {
      capture(request);
      const decode = Boolean(request.latents_base64);
      return {
        direction: decode ? 'decode' : 'encode',
        latents_base64: decode ? null : 'AAAA',
        audio_data_base64: decode ? 'data:audio/wav;base64,UklGRg==' : null,
        sample_rate: 48000,
        duration_seconds: 1,
        latent_frames: decode ? null : 1,
        num_samples: decode ? 48000 : null,
      };
    },
  });

  const ace = new AceStep();
  const selected = { modelId: 'ace-step-v1.5-turbo' };
  await ace.generateMusic('prompt', () => {}, undefined, undefined, selected);
  await ace.lm({ caption: 'prompt' }, selected);
  await ace.synth({ caption: 'prompt' }, selected);
  await ace.understand({ audioBase64: 'AAAA' }, selected);
  await ace.vaeEncode('AAAA', selected);
  await ace.vaeDecode('AAAA', selected);

  assert.deepEqual(seen, Array(6).fill(selected.modelId));
});
