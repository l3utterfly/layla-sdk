import {
  LaylaSDK,
  type NeoDragonCrop,
  type NeoDragonGenerateVideoOptions,
  type NeoDragonGenerateVideoResult,
  type NeoDragonProgress,
} from '../src';

const layla = new LaylaSDK();
const crop: NeoDragonCrop = { x: 0, y: 0, width: 1, height: 1 };
const options: NeoDragonGenerateVideoOptions = {
  seed: 0,
  upscale: true,
  fps: 24,
  cinematicPrompt: false,
  crop,
  onProgress(progress: NeoDragonProgress) {
    progress.fraction.toFixed(2);
  },
};

const generated: Promise<NeoDragonGenerateVideoResult> =
  layla.neodragon.generateVideo(
    'data:image/png;base64,c291cmNl',
    'A slow cinematic orbit',
    options,
  );

void generated;
