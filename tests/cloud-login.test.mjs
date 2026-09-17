// Run after npm run build: node --test tests/cloud-login.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Cloud, LaylaAbortError, installLaylaMock } from '../dist/index.js';

// One window for the whole file: the bridge binds its `message` listener to the
// first one it sees, so a per-test window would leave later tests unheard.
globalThis.window = new EventTarget();

let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

test('sends the login command and resolves with the mock access token', async () => {
  const messages = [];
  mock = installLaylaMock({ latencyMs: 0 });
  const host = window.ReactNativeWebView;
  const post = host.postMessage.bind(host);
  host.postMessage = raw => {
    messages.push(JSON.parse(raw));
    post(raw);
  };

  const token = await new Cloud().login();

  assert.equal(typeof token, 'string');
  assert.deepEqual(
    messages.map(({ cmd, data }) => ({ cmd, data })),
    [{ cmd: 'layla_cloud_login', data: null }],
  );
});

test('a custom handler supplies the token, and null models a declined login', async () => {
  mock = installLaylaMock({ latencyMs: 0, cloudLogin: () => 'token-from-handler' });
  assert.equal(await new Cloud().login(), 'token-from-handler');
  mock.uninstall();

  mock = installLaylaMock({ latencyMs: 0, cloudLogin: async () => null });
  assert.equal(await new Cloud().login(), null);
});

test('an aborted login rejects with LaylaAbortError', async () => {
  mock = installLaylaMock({ latencyMs: 50 });
  const controller = new AbortController();
  const pending = new Cloud().login({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error instanceof LaylaAbortError);
});
