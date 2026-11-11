// Run after npm run build: node --test tests/diagnostics-image-gen-tags.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import ts from 'typescript';
import { LaylaSDK, LaylaAbortError, installLaylaMock } from '../dist/index.js';

// Execute the actual example checks, rather than duplicating their assertions here.
const source = await readFile(new URL('../examples/diagnostics/src/image-gen-tags.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
});
const { createImageGenTagGroup } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

globalThis.window = new EventTarget();
let mock;
afterEach(() => { mock?.uninstall(); mock = undefined; delete window.ReactNativeWebView; });
class Skipped extends Error {}
const group = () => createImageGenTagGroup((reason) => { throw new Skipped(reason); });
const seed = {
  'demo/tags.csv': [
    { english: 'blue_hair', category: 0, post_count: 100, aliases: ['azure_hair'] },
    { english: 'blue_eyes', category: 0, post_count: 80, aliases: [] },
    { english: 'artist_name', category: 1, post_count: 50, aliases: [] },
    { english: 'masterpiece', category: 5, post_count: 40, aliases: [] },
  ],
  'second/tags.csv': [{ english: 'other_tag', category: 0, post_count: 0, aliases: [] }],
};
const context = (signal = new AbortController().signal) => {
  const log = [];
  return { layla: new LaylaSDK(), sessionId: 'diagnostics-test', signal, log: (text) => log.push(text), lines: log };
};

test('Run all includes all seven tag checks and leaves both dictionaries unchanged', { timeout: 5000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: seed });
  const ctx = context();
  const checks = group().checks.filter((check) => check.weight !== 'heavy');
  assert.equal(checks.length, 7);
  for (const check of checks) assert.equal(typeof await check.run(ctx), 'string', check.id);
  for (const [filename, tags] of Object.entries(seed)) {
    assert.deepEqual((await ctx.layla.images.getTags(filename)).tags, tags);
  }
  assert(ctx.lines.some((line) => line.includes('cleanup') && line.includes('deleted')));
});

test('every check runs independently, including against an initially empty dictionary', { timeout: 5000 }, async () => {
  for (const check of group().checks) {
    mock?.uninstall();
    mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: { 'empty/tags.csv': [] } });
    const ctx = context();
    await check.run(ctx);
    assert.deepEqual((await ctx.layla.images.getTags('empty/tags.csv')).tags, [], check.id);
  }
});

test('an empty library passes discovery and skips the six dictionary operations', { timeout: 5000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: {} });
  const ctx = context();
  for (const check of group().checks) {
    if (check.id === 'images.getTagDictionaries') {
      assert.match(await check.run(ctx), /0 available/);
    } else {
      await assert.rejects(check.run(ctx), (error) => error instanceof Skipped && /no tag dictionaries/.test(error.message));
    }
  }
});

test('Stop after a persisted create still cleans up without the aborted signal', { timeout: 5000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: seed });
  const controller = new AbortController();
  const ctx = context(controller.signal);
  const upsert = ctx.layla.images.upsertTag.bind(ctx.layla.images);
  ctx.layla.images.upsertTag = async (...args) => {
    const saved = await upsert(...args);
    controller.abort();
    return saved;
  };
  await assert.rejects(group().checks.find((check) => check.id === 'images.upsertTag').run(ctx), LaylaAbortError);
  assert.deepEqual((await ctx.layla.images.getTags('demo/tags.csv')).tags, seed['demo/tags.csv']);
  assert(ctx.lines.some((line) => line.includes('cleanup') && line.endsWith('deleted')));
});

test('verification failures after renaming clean up both possible temporary names', { timeout: 5000 }, async () => {
  mock = installLaylaMock({ latencyMs: 0, imageTagDictionaries: seed });
  const ctx = context();
  const lookup = ctx.layla.images.getTag.bind(ctx.layla.images);
  ctx.layla.images.getTag = async (...args) => {
    const tag = await lookup(...args);
    if (tag?.english.endsWith('_renamed')) throw new Error('simulated lookup failure after rename');
    return tag;
  };
  await assert.rejects(group().checks.find((check) => check.id === 'images.upsertTag').run(ctx), /simulated lookup failure/);
  assert.deepEqual((await ctx.layla.images.getTags('demo/tags.csv')).tags, seed['demo/tags.csv']);
});
