import type { BackgroundAudioTrack, LaylaSDK } from '../src';
import type { LaylaMockBackgroundAudioController } from '../src/mock';

declare const layla: LaylaSDK;
const tracks: BackgroundAudioTrack[] = [{ file: 'one.mp3', title: 'One' }];

const modern: Promise<void> = layla.backgroundAudio.start(tracks);
const legacy: Promise<void> = layla.backgroundAudio.start(['one.mp3']);
layla.backgroundAudio.start(['one.mp3'], { title: 'One' });
layla.backgroundAudio.start([]);
layla.backgroundAudio.start([], { title: 'Empty' });

// @ts-expect-error Track objects require a file.
layla.backgroundAudio.start([{ title: 'Missing file' }]);
// @ts-expect-error Queue shapes cannot be mixed.
layla.backgroundAudio.start(['one.mp3', { file: 'two.mp3' }]);
// @ts-expect-error Shared metadata is only supported by the legacy overload.
layla.backgroundAudio.start(tracks, { title: 'Shared' });

// Existing custom mock controllers must still compile unchanged.
const controller: LaylaMockBackgroundAudioController = {
  start(request) { request.queueAudioFiles.map(file => file.toUpperCase()); },
  stop() {},
  pause() {},
  resume() {},
  skip() {},
};
void [modern, legacy, controller];
