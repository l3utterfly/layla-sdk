// Run after npm run build: node --test tests/image-gen-tags.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LaylaSDK, LaylaError, LaylaAbortError, LaylaBridgeUnavailableError, installLaylaMock } from '../dist/index.js';

globalThis.window = new EventTarget();
let mock;
afterEach(() => { mock?.uninstall(); mock = undefined; delete window.ReactNativeWebView; });
const tag = { english: 'blue_hair', category: 0, post_count: 100, aliases: ['azure_hair'] };
const filename = 'demo/tags.csv';
const page = { dictionary_filename: filename, tags: [tag], total: 7, offset: 0, limit: 50 };
const reply = (request, event, data) => window.dispatchEvent(new MessageEvent('message', {
  data: JSON.stringify({ id: request.id, event, data }),
}));

test('all seven Images methods send native commands and extract their documented return values', { timeout: 1000 }, async () => {
  const images = new LaylaSDK().images;
  const cases = [
    [() => images.suggestTags(filename, 'blu hr'), 'suggest_tags', { dictionary_filename: filename, query: 'blu hr', limit: 40 },
      { dictionary_filename: filename, query: 'blu hr', limit: 40, suggestions: [] }, []],
    [() => images.getTagDictionaries(), 'get_dictionaries', null, [{ dictionary_filename: filename }], [{ dictionary_filename: filename }]],
    [() => images.getTags(filename), 'get_tags', { dictionary_filename: filename, offset: 0, limit: 50 }, page, page],
    [() => images.getTag(filename, tag.english), 'get_tag', { dictionary_filename: filename, english: tag.english },
      { dictionary_filename: filename, english: tag.english, tag }, tag],
    [() => images.upsertTag(filename, tag), 'upsert_tag', { dictionary_filename: filename, tag, replacing: null },
      { dictionary_filename: filename, tag }, tag],
    [() => images.deleteTag(filename, tag.english), 'delete_tag', { dictionary_filename: filename, english: tag.english },
      { dictionary_filename: filename, english: tag.english, deleted: true }, true],
    [() => images.searchTags(filename, 'blue'), 'search_tags', { dictionary_filename: filename, query: 'blue', offset: 0, limit: 50 },
      { ...page, query: 'blue', mode: 'name' }, { ...page, query: 'blue', mode: 'name' }],
  ];
  for (const [call, suffix, data, response, expected] of cases) {
    window.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw);
      assert.equal(request.cmd, `image_gen_tag_${suffix}`);
      assert.deepEqual(request.data, data);
      reply(request, `on_image_gen_tag_${suffix}_response`, response);
    } };
    assert.deepEqual(await call(), expected);
  }
});

test('preserves explicit pagination/category zero, search mode and rename targets', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage(raw) {
    const request = JSON.parse(raw);
    sent.push(request.data);
    reply(request, `on_${request.cmd}_response`, request.cmd === 'image_gen_tag_upsert_tag'
      ? { dictionary_filename: filename, tag } : { ...page, tags: [], total: 0 });
  } };
  const images = new LaylaSDK().images;
  await images.getTags(filename, { offset: 0, limit: 0, category: 0 });
  await images.searchTags(filename, 'blue', { mode: 'prefix', offset: 2, limit: 0, category: null });
  await images.upsertTag(filename, tag, 'previous_name');
  assert.deepEqual(sent, [
    { dictionary_filename: filename, offset: 0, limit: 0, category: 0 },
    { dictionary_filename: filename, query: 'blue', mode: 'prefix', offset: 2, limit: 0, category: null },
    { dictionary_filename: filename, tag, replacing: 'previous_name' },
  ]);
});

test('returns null for an absent tag and false for a repeated deletion', { timeout: 1000 }, async () => {
  window.ReactNativeWebView = { postMessage(raw) {
    const request = JSON.parse(raw);
    reply(request, `on_${request.cmd}_response`, { ...request.data, tag: null, deleted: false });
  } };
  const images = new LaylaSDK().images;
  assert.equal(await images.getTag(filename, 'absent'), null);
  assert.equal(await images.deleteTag(filename, 'absent'), false);
});

const methods = (images, options) => [
  () => images.getTagDictionaries(options),
  () => images.getTags(filename, options),
  () => images.getTag(filename, tag.english, options),
  () => images.upsertTag(filename, tag, null, options),
  () => images.deleteTag(filename, tag.english, options),
  () => images.searchTags(filename, 'blue', options),
  () => images.suggestTags(filename, 'blue', options),
];

test('every tag method propagates host errors and rejects without a bridge', { timeout: 1000 }, async () => {
  const images = new LaylaSDK().images;
  for (const call of methods(images)) await assert.rejects(call(), LaylaBridgeUnavailableError);
  window.ReactNativeWebView = { postMessage(raw) {
    reply(JSON.parse(raw), 'on_error', { message: 'Dictionary write failed' });
  } };
  for (const call of methods(images)) await assert.rejects(call(), (error) =>
    error instanceof LaylaError && error.message === 'Dictionary write failed');
});

test('every tag method supports an already-aborted signal without posting', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(raw) };
  const controller = new AbortController();
  controller.abort();
  for (const call of methods(new LaylaSDK().images, { signal: controller.signal })) {
    await assert.rejects(call(), LaylaAbortError);
  }
  assert.deepEqual(sent, []);
});

test('an in-flight abort drains its late response and allows the next lookup', { timeout: 1000 }, async () => {
  const sent = [];
  window.ReactNativeWebView = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
  const images = new LaylaSDK().images;
  const controller = new AbortController();
  const aborted = assert.rejects(images.getTag(filename, 'first', { signal: controller.signal }), LaylaAbortError);
  const next = images.getTag(filename, 'second');
  controller.abort();
  await aborted;
  reply(sent[0], 'on_image_gen_tag_get_tag_response', { dictionary_filename: filename, english: 'first', tag: null });
  assert.equal(sent.length, 2);
  reply(sent[1], 'on_image_gen_tag_get_tag_response', { dictionary_filename: filename, english: 'second', tag });
  assert.deepEqual(await next, tag);
});

test('mock CRUD persists per dictionary, normalizes aliases and leaves caller seeds unchanged', { timeout: 1000 }, async () => {
  const seed = { [filename]: [tag], 'other/tags.csv': [] };
  const original = structuredClone(seed);
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: seed });
  const images = new LaylaSDK().images;
  assert.deepEqual(await images.getTagDictionaries(), [{ dictionary_filename: filename }, { dictionary_filename: 'other/tags.csv' }]);
  const created = await images.upsertTag(filename, { ...tag, english: 'new_tag', aliases: [' a ', 'a', 'new_tag'] });
  assert.deepEqual(created.aliases, ['a']);
  assert.equal((await images.getTags('other/tags.csv')).total, 0);
  const renamed = await images.upsertTag(filename, { ...created, english: 'renamed' }, 'new_tag');
  assert.deepEqual(await images.getTag(filename, 'renamed'), renamed);
  assert.equal(await images.getTag(filename, 'new_tag'), null);
  assert.equal(await images.deleteTag(filename, 'renamed'), true);
  assert.equal(await images.deleteTag(filename, 'renamed'), false);
  assert.deepEqual(seed, original);
});

test('upsert creates missing raw dictionaries only for valid new tags', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: {} });
  const images = new LaylaSDK().images;
  const newFilename = 'new/deep/tags.csv';
  await assert.rejects(images.upsertTag('missing-target.csv', tag, 'old_tag'), /not found/);
  await assert.rejects(images.getTags('missing-target.csv'), /not found/);
  await assert.rejects(images.upsertTag('invalid.csv', { ...tag, category: -1 }), /nonnegative/);
  await assert.rejects(images.getTags('invalid.csv'), /not found/);
  await assert.rejects(images.upsertTag('../outside.csv', tag), /relative/);
  assert.deepEqual(await images.upsertTag(newFilename, tag), tag);
  assert.deepEqual(await images.getTag(newFilename, tag.english), tag);
  await images.upsertTag(newFilename, { ...tag, english: 'second_tag' });
  assert.equal((await images.getTags(newFilename)).total, 2);
  assert.equal((await images.suggestTags(newFilename, 'azure')).length, 2);
  // Like native discovery, the managed library does not register raw CSVs.
  assert.deepEqual(await images.getTagDictionaries(), []);
});

test('mock search handles normalization, exact ordering, prefixes, filters and pagination', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: { [filename]: [
    tag, { ...tag, english: 'dark_blue', aliases: [] },
    { ...tag, english: 'blue', category: 4, aliases: [] }, { ...tag, english: 'blue_eyes', aliases: [] },
  ] } });
  const images = new LaylaSDK().images;
  const names = await images.searchTags(filename, 'BLUE');
  assert.deepEqual(names.tags.map((entry) => entry.english), ['blue', 'blue_hair', 'dark_blue', 'blue_eyes']);
  const prefix = await images.searchTags(filename, 'blue', { mode: 'prefix', offset: 1, limit: 1 });
  assert.equal(prefix.total, 3);
  assert.deepEqual(prefix.tags.map((entry) => entry.english), ['blue_hair']);
  assert.equal((await images.searchTags(filename, 'Azure Hair')).total, 1);
  assert.equal((await images.searchTags(filename, 'blue', { category: 4, limit: 0 })).total, 1);
  assert.deepEqual((await images.getTags(filename, { offset: 100 })).tags, []);
});

test('suggestTags forwards a custom limit and preserves all native suggestion metadata', { timeout: 1000 }, async () => {
  const suggestion = { replacement_tag: 'blue_hair', primary_text: 'blue_hair', secondary_text: '蓝色头发',
    match_type: 'translation', category: 0, post_count: 100, score: 91.5 };
  window.ReactNativeWebView = { postMessage(raw) {
    const request = JSON.parse(raw);
    assert.deepEqual(request.data, { dictionary_filename: filename, query: '蓝色', limit: 1 });
    reply(request, 'on_image_gen_tag_suggest_tags_response', { ...request.data, suggestions: [suggestion] });
  } };
  assert.deepEqual(await new LaylaSDK().images.suggestTags(filename, '蓝色', { limit: 1 }), [suggestion]);
});

test('mock suggestions are bounded fuzzy name/alias matches, reflect edits and accept blank/zero requests', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: { [filename]: [tag] } });
  const images = new LaylaSDK().images;
  const fuzzy = await images.suggestTags(filename, 'blu hr', { limit: 1 });
  assert.equal(fuzzy.length, 1);
  assert.equal(fuzzy[0].replacement_tag, tag.english);
  assert.equal(fuzzy[0].match_type, 'fuzzy');
  assert(Number.isFinite(fuzzy[0].score));
  const alias = await images.suggestTags(filename, 'azure hair');
  assert.equal(alias[0].match_type, 'alias');
  assert.equal(alias[0].secondary_text, 'azure hair');
  assert.deepEqual(await images.suggestTags(filename, '  '), []);
  assert.deepEqual(await images.suggestTags(filename, 'blue', { limit: 0 }), []);
  await assert.rejects(images.suggestTags(filename, 'blue', { limit: -1 }), /nonnegative/);
  await images.deleteTag(filename, tag.english);
  assert.deepEqual(await images.suggestTags(filename, 'blue'), []);
});

test('mock validates paths, dictionaries and edits, and recovers after errors', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: { [filename]: [tag] } });
  const images = new LaylaSDK().images;
  for (const invalid of ['', '../escape.csv', '/absolute.csv', 'C:/drive.csv', 'file:///tags.csv', 'a\\b.csv', 'a//b.csv', 'a/./b.csv']) {
    await assert.rejects(images.getTag(invalid, tag.english), LaylaError);
  }
  await assert.rejects(images.getTags('absent.csv'), /not found/);
  await assert.rejects(images.upsertTag(filename, tag), /already exists/);
  await assert.rejects(images.upsertTag(filename, tag, 'absent'), /not found/);
  await assert.rejects(images.getTags(filename, { offset: -1 }), /nonnegative/);
  await assert.rejects(images.searchTags(filename, ''), /non-empty/);
  await assert.rejects(images.searchTags(filename, 'blue', { mode: 'invalid' }), /mode/);
  assert.deepEqual(await images.getTag(filename, tag.english), tag);
});

test('mixed mock operations return errors to their own requests and preserve edit order', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: { [filename]: [], 'other/tags.csv': [tag] } });
  const images = new LaylaSDK().images;
  await images.upsertTag(filename, tag);
  const results = await Promise.allSettled([
    images.upsertTag(filename, tag),
    images.getTag('other/tags.csv', tag.english), images.deleteTag(filename, tag.english),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.match(results[0].reason.message, /already exists/);
  assert.deepEqual(results[1].value, tag);
  assert.equal(results[2].value, true);
  assert.equal(await images.getTag(filename, tag.english), null);
});

test('default and empty mock libraries are usable and simulated failures do not mutate tags', { timeout: 1000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const images = new LaylaSDK().images;
  assert.deepEqual(await images.getTagDictionaries(), [{ dictionary_filename: 'mock/tags.csv' }]);
  assert.equal((await images.getTags('mock/tags.csv')).total, 2);
  mock.uninstall();
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: {} });
  assert.deepEqual(await images.getTagDictionaries(), []);
  mock.uninstall();
  mock = installLaylaMock({ latencyMs: 0, errorRate: 1 });
  await assert.rejects(images.deleteTag('mock/tags.csv', 'blue_hair'), /Simulated/);
});
