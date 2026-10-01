// Run after npm run build: node --test tests/save-chat-message.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LaylaAbortError, LaylaError, LaylaSDK, installLaylaMock } from '../dist/index.js';

globalThis.window = new EventTarget();
let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

function recordWire() {
  const messages = [];
  const host = window.ReactNativeWebView;
  const post = host.postMessage.bind(host);
  host.postMessage = raw => {
    messages.push(JSON.parse(raw));
    post(raw);
  };
  return messages;
}

const params = {
  id: 0,
  session_id: 'new-session',
  character_id: 'character',
  display_message: 'Visible summary',
  message: 'Summary with context for the LLM',
  timestamp: 123,
};

test('posts separate display and model text and returns the stored entry', async () => {
  mock = installLaylaMock({ latencyMs: 0, chatHistory: [] });
  const wire = recordWire();
  const layla = new LaylaSDK();
  const saved = await layla.chat.saveChatMessage(params);

  assert.deepEqual(wire.map(({ cmd, data }) => ({ cmd, data })), [
    { cmd: 'save_chat_message', data: params },
  ]);
  assert.deepEqual(saved, { ...params, id: 1, content: params.message, role: 'assistant' });
  assert.equal(params.id, 0, 'does not mutate the input');
  const history = await layla.chat.getChatHistory(params.session_id);
  assert.equal(history[0].content, params.message);
  assert.equal(history[0].image_base64, undefined, 'new entries have no image');
  const { sessions } = await layla.chat.getChatSessions(params.character_id);
  assert.equal(sessions[0].session_id, params.session_id);
});

test('non-positive IDs allocate IDs and non-positive timestamps use the host time', async () => {
  mock = installLaylaMock({ latencyMs: 0, chatHistory: [] });
  const layla = new LaylaSDK();
  const before = Date.now();
  const saved = await layla.chat.saveChatMessage({
    ...params, id: -5, timestamp: -1, character_id: 'user',
  });
  assert.equal(saved.id, 1);
  assert.equal(saved.role, 'user');
  assert.ok(saved.timestamp >= before && saved.timestamp <= Date.now());
  const second = await layla.chat.saveChatMessage({ ...params, timestamp: 0 });
  assert.equal(second.id, 2);
  assert.ok(second.timestamp >= before && second.timestamp <= Date.now());
});

test('updates overwrite fields, move and re-date entries, and preserve their images', async () => {
  const image = 'data:image/png;base64,aW1n';
  mock = installLaylaMock({ latencyMs: 0, chatHistory: [{
    id: 9, session_id: 'old-session', character_id: 'old-character',
    timestamp: 100, role: 'assistant', content: 'Old text', image_base64: image,
  }] });
  const layla = new LaylaSDK();
  const input = { ...params, id: 9, character_id: 'user', timestamp: 456 };
  const saved = await layla.chat.saveChatMessage(input);
  assert.deepEqual(saved, { ...input, content: input.message, role: 'user' });
  assert.deepEqual(await layla.chat.getChatHistory('old-session'), []);
  assert.deepEqual(await layla.chat.getChatHistory(input.session_id), [{
    id: 9, session_id: input.session_id, character_id: 'user', timestamp: 456,
    role: 'user', content: input.message, image_base64: image,
  }]);
  assert.deepEqual((await layla.chat.getChatSessions('old-character')).sessions, []);
  const created = await layla.chat.saveChatMessage(params);
  assert.equal(created.id, 10, 'new IDs do not collide with existing entries');
  assert.deepEqual((await layla.chat.getChatHistory(input.session_id)).map(e => e.id), [9, 10]);
});

test('updating a missing positive ID rejects without creating an entry', async () => {
  mock = installLaylaMock({ latencyMs: 0, chatHistory: [] });
  const layla = new LaylaSDK();
  await assert.rejects(layla.chat.saveChatMessage({ ...params, id: 99 }),
    error => error instanceof LaylaError && /does not exist/.test(error.message));
  assert.deepEqual(await layla.chat.getChatHistory(params.session_id), []);
  assert.equal((await layla.chat.saveChatMessage(params)).id, 1);
});

test('simulated host errors reject with LaylaError', async () => {
  mock = installLaylaMock({ latencyMs: 0, errorRate: 1, chatHistory: [] });
  await assert.rejects(new LaylaSDK().chat.saveChatMessage(params),
    error => error instanceof LaylaError && /save chat message/.test(error.message));
});

test('concurrent saves resolve to their own entries', async () => {
  mock = installLaylaMock({ latencyMs: 1, chatHistory: [] });
  const layla = new LaylaSDK();
  const inputs = [params, { ...params, message: 'Second model text', display_message: 'Second text' }];
  const results = await Promise.all(inputs.map(input => layla.chat.saveChatMessage(input)));
  assert.deepEqual(results.map(e => e.id), [1, 2]);
  assert.deepEqual(results.map(e => e.message), inputs.map(e => e.message));
});

test('an already-aborted save never posts or stores an entry', async () => {
  mock = installLaylaMock({ latencyMs: 0, chatHistory: [] });
  const wire = recordWire();
  const controller = new AbortController();
  controller.abort();
  const layla = new LaylaSDK();
  await assert.rejects(layla.chat.saveChatMessage(params, { signal: controller.signal }),
    error => error instanceof LaylaAbortError);
  assert.deepEqual(wire, []);
  assert.deepEqual(await layla.chat.getChatHistory(params.session_id), []);
});

test('aborting an active save rejects and the next save still completes', async () => {
  mock = installLaylaMock({ latencyMs: 20, chatHistory: [] });
  const controller = new AbortController();
  const layla = new LaylaSDK();
  const pending = layla.chat.saveChatMessage(params, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error instanceof LaylaAbortError);
  const next = await layla.chat.saveChatMessage({ ...params, message: 'Next message' });
  assert.equal(next.message, 'Next message');
});
