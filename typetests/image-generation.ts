import {
  LaylaSDK,
  type GenerateImageOptions,
  type LaylaApiGenerateImage,
  type RequestOptions,
} from '../src';

const layla = new LaylaSDK();
const onProgress = (status: string, step: number, totalSteps: number) => {
  void [status, step, totalSteps];
};
const references = ['data:image/png;base64,cmVmZXJlbmNl'];
const options: GenerateImageOptions = {
  referenceImages: references,
  signal: new AbortController().signal,
};
const legacyOptions: RequestOptions = { signal: options.signal };
const generated: Promise<string | null> = layla.images.generateImage(
  'Edit these references', onProgress, undefined, 'reference-model', options,
);
void generated;
void layla.images.generateImage('Draw', onProgress);
void layla.images.generateImage('Draw', onProgress, undefined, undefined, legacyOptions);
const request: LaylaApiGenerateImage = {
  cmd: 'generate_image', data: { prompt: 'Edit', reference_images: references },
};
void request;

// @ts-expect-error References must be an array of data URI strings.
const invalidReferences: GenerateImageOptions = { referenceImages: 'data:image/png;base64,YQ==' };
// @ts-expect-error Reference entries must be strings.
const invalidEntry: GenerateImageOptions = { referenceImages: [42] };
void [invalidReferences, invalidEntry];
