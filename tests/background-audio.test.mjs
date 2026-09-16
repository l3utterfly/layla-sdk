// Run after npm run build: node --test tests/background-audio.test.mjs
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BackgroundAudio, installLaylaMock } from '../dist/index.js';

const tracks = [
  { file: 'one.mp3', title: 'One', artist: 'Artist', albumTitle: 'Album', artworkUrl: 'https://example.com/one.png' },
  { file: 'two.mp3', title: 'Two' },
];
let mock;
beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
  delete globalThis.window;
});

test('start preserves legacy payloads and selects v2 for track objects', async () => {
  const messages = [];
  window.ReactNativeWebView = { postMessage: raw => messages.push(JSON.parse(raw)) };
  const audio = new BackgroundAudio();
  await audio.start(['one.mp3']);
  await audio.start(['one.mp3'], { title: 'Shared' });
  await audio.start(tracks);
  await audio.start([]);
  await audio.start([], { title: 'Empty' });
  assert.deepEqual(messages, [
    { cmd: 'start_background_audio_player', data: { queueAudioFiles: ['one.mp3'] } },
    { cmd: 'start_background_audio_player', data: { queueAudioFiles: ['one.mp3'], metadata: { title: 'Shared' } } },
    { cmd: 'start_background_audio_player_v2', data: tracks },
    { cmd: 'start_background_audio_player', data: { queueAudioFiles: [] } },
    { cmd: 'start_background_audio_player', data: { queueAudioFiles: [], metadata: { title: 'Empty' } } },
  ]);
});

test('built-in mock plays and skips a v2 queue, and clears an empty queue', async () => {
  mock = installLaylaMock();
  const audio = new BackgroundAudio();
  const statuses = [];
  const changes = [];
  audio.on('status', data => statuses.push(data));
  audio.on('trackChanged', data => changes.push(data));
  await audio.start(tracks);
  assert.equal(statuses.at(-1).playing, true);
  assert.equal(statuses.at(-1).currentIndex, 0);
  await audio.skip();
  assert.deepEqual(changes, [{ previousIndex: 0, currentIndex: 1 }]);
  await audio.start([]);
  const count = statuses.length;
  await audio.resume();
  assert.equal(statuses.length, count);
});

test('custom mock retains legacy start and can receive all v2 metadata', async () => {
  const legacy = [];
  const modern = [];
  mock = installLaylaMock({ backgroundAudio: () => ({
    start: data => legacy.push(data),
    startV2: data => modern.push(data),
    stop() {}, pause() {}, resume() {}, skip() {},
  }) });
  const audio = new BackgroundAudio();
  await audio.start(['old.mp3'], { title: 'Old' });
  await audio.start(tracks);
  assert.deepEqual(legacy, [{ queueAudioFiles: ['old.mp3'], metadata: { title: 'Old' } }]);
  assert.deepEqual(modern, [tracks]);
});

test('v2 playback falls back for existing custom mock controllers', async () => {
  const requests = [];
  mock = installLaylaMock({ backgroundAudio: () => ({
    start: data => requests.push(data),
    stop() {}, pause() {}, resume() {}, skip() {},
  }) });
  await new BackgroundAudio().start(tracks);
  const { file, ...metadata } = tracks[0];
  assert.deepEqual(requests, [{ queueAudioFiles: ['one.mp3', 'two.mp3'], metadata }]);
});
