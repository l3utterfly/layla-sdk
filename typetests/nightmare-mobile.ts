import {
  LaylaSDK,
  NightmareMobile,
  type NightmareMobileModel,
  type NightmareMobileGenerateVideoOptions,
  type NightmareMobileGenerateVideoResult,
  type NightmareMobileProgress,
  type NightmareMobileProgressListener,
  type LaylaApiNightmareMobileGetModels,
  type LaylaApiNightmareMobileGenerateVideo,
  type LaylaApiEvent_onNightmareMobileGetModelsResponse,
  type LaylaApiEvent_onNightmareMobileGenerateVideoResponse,
  type LaylaApiEvent_onNightmareMobileGenerateVideoProgress,
} from '../src';

const resource: NightmareMobile = new LaylaSDK().nightmareMobile;
const onProgress: NightmareMobileProgressListener = (progress: NightmareMobileProgress) => {
  progress.stage.toUpperCase();
  progress.total_passes?.toFixed(0);
};
const options: NightmareMobileGenerateVideoOptions = {
  width: 1601,
  height: 901,
  frames: 200,
  fps: 30,
  seed: '18446744073709551615',
  negativePrompt: '',
  imageDataBase64: 'data:image/png;base64,YQ==',
  endImageDataBase64: 'data:image/png;base64,Yg==',
  denoiseStrength: 0,
  signal: new AbortController().signal,
  onProgress,
};
const models: Promise<NightmareMobileModel[]> = resource.getModels({ signal: options.signal });
const video: Promise<NightmareMobileGenerateVideoResult> = resource.generateVideo(
  'chosen',
  'Waves',
  options,
);
void [models, video];
const list: LaylaApiNightmareMobileGetModels = { cmd: 'nightmaremobile_get_models', data: null };
const request: LaylaApiNightmareMobileGenerateVideo = {
  cmd: 'nightmaremobile_generate_video',
  data: {
    model_id: 'chosen',
    prompt: 'Waves',
    frames: 200,
    fps: 30,
  },
};
const progress: LaylaApiEvent_onNightmareMobileGenerateVideoProgress = {
  event: 'on_nightmaremobile_generate_video_progress',
  data: { stage: 'loading' },
};
const modelResponse = {} as LaylaApiEvent_onNightmareMobileGetModelsResponse;
const videoResponse = {} as LaylaApiEvent_onNightmareMobileGenerateVideoResponse;
void [list, request, progress, modelResponse, videoResponse];

// @ts-expect-error Duration is not a public option; supply frames and fps.
resource.generateVideo('chosen', 'Waves', { duration: 2 });
// @ts-expect-error Aspect ratio is not a public option; supply width and height.
resource.generateVideo('chosen', 'Waves', { aspectRatio: '16:9' });
// @ts-expect-error LoRAs remain in the host's saved configuration.
resource.generateVideo('chosen', 'Waves', { loras: [] });
// @ts-expect-error Sampling is not exposed.
resource.generateVideo('chosen', 'Waves', { sampling: { steps: 1 } });
// @ts-expect-error Frames must be a number.
resource.generateVideo('chosen', 'Waves', { frames: '200' });
// @ts-expect-error The resolved seed is a decimal string, not a number.
const numericSeed: number = videoResponse.data.seed;
void numericSeed;
