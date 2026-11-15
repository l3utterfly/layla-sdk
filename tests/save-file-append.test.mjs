// Run after npm run build: node --test tests/save-file-append.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LaylaSDK, SAVE_FILE_PART_BYTES, installLaylaMock } from '../dist/index.js';

globalThis.window = new EventTarget();
// The built-in mock store decodes base64 with the browser's window.atob/btoa.
window.atob = atob;
window.btoa = btoa;
let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

/** A host that keeps files in memory and honours `append`, recording each message. */
function fileHost({ appends = true } = {}) {
  const files = new Map();
  const messages = [];
  const saveFile = ({ filename, contentBase64, share, append }) => {
    messages.push({ filename, bytes: Buffer.from(contentBase64, 'base64').length, share, append });
    const part = Buffer.from(contentBase64, 'base64');
    const previous = appends && append ? (files.get(filename) ?? Buffer.alloc(0)) : Buffer.alloc(0);
    const bytes = Buffer.concat([previous, part]);
    files.set(filename, bytes);
    return { filename, success: true, ...(appends ? { size: bytes.length } : {}) };
  };
  return { files, messages, saveFile };
}

const bytes = (length, fill) => new Uint8Array(length).fill(fill);

test('append adds to the end of the file and reports its size', async () => {
  const host = fileHost();
  mock = installLaylaMock({ latencyMs: 0, saveFile: host.saveFile });
  const layla = new LaylaSDK();

  const first = await layla.utils.saveFile('a.bin', bytes(10, 1));
  assert.deepEqual(first, { filename: 'a.bin', success: true, size: 10 });
  const second = await layla.utils.saveFile('a.bin', bytes(5, 2), false, { append: true });
  assert.deepEqual(second, { filename: 'a.bin', success: true, size: 15 });

  assert.deepEqual([...host.files.get('a.bin')], [...bytes(10, 1), ...bytes(5, 2)]);
  assert.deepEqual(
    host.messages.map((m) => m.append),
    [false, true],
  );
});

test('append creates a file that does not exist yet', async () => {
  const host = fileHost();
  mock = installLaylaMock({ latencyMs: 0, saveFile: host.saveFile });
  const result = await new LaylaSDK().utils.saveFile('new.bin', bytes(4, 7), false, { append: true });
  assert.deepEqual(result, { filename: 'new.bin', success: true, size: 4 });
  assert.equal(host.files.get('new.bin').length, 4);
});

test('a large append is sent in parts that all append, sharing only on the last', async () => {
  const host = fileHost();
  mock = installLaylaMock({ latencyMs: 0, saveFile: host.saveFile });
  const layla = new LaylaSDK();
  await layla.utils.saveFile('big.bin', bytes(100, 1));

  const extra = SAVE_FILE_PART_BYTES * 2 + 123;
  const result = await layla.utils.saveFile('big.bin', bytes(extra, 2), true, { append: true });
  assert.equal(result.success, true);
  assert.equal(result.size, 100 + extra);
  assert.equal(host.files.get('big.bin').length, 100 + extra);
  assert.deepEqual(host.messages.slice(1), [
    { filename: 'big.bin', bytes: SAVE_FILE_PART_BYTES, share: false, append: true },
    { filename: 'big.bin', bytes: SAVE_FILE_PART_BYTES, share: false, append: true },
    { filename: 'big.bin', bytes: 123, share: true, append: true },
  ]);
});

test('without append a large file still replaces the old one', async () => {
  const host = fileHost();
  mock = installLaylaMock({ latencyMs: 0, saveFile: host.saveFile });
  const layla = new LaylaSDK();
  await layla.utils.saveFile('big.bin', bytes(100, 1));
  const size = SAVE_FILE_PART_BYTES + 1;
  const result = await layla.utils.saveFile('big.bin', bytes(size, 2));
  assert.deepEqual(result, { filename: 'big.bin', success: true, size });
  assert.deepEqual(
    host.messages.slice(1).map((m) => m.append),
    [false, true],
  );
});

test('append fails on a host that cannot append', async () => {
  const host = fileHost({ appends: false });
  mock = installLaylaMock({ latencyMs: 0, saveFile: host.saveFile });
  const layla = new LaylaSDK();
  await layla.utils.saveFile('a.bin', bytes(10, 1));

  const small = await layla.utils.saveFile('a.bin', bytes(5, 2), false, { append: true });
  assert.equal(small.success, false);
  assert.match(small.message, /cannot append/);

  const large = await layla.utils.saveFile('a.bin', bytes(SAVE_FILE_PART_BYTES + 1, 2), false, { append: true });
  assert.equal(large.success, false);
  assert.match(large.message, /cannot append/);
  // It stops after the first part instead of sending the rest.
  assert.equal(host.messages.length, 3);
});

test('the built-in mock store appends too', async () => {
  mock = installLaylaMock({ latencyMs: 0 });
  const layla = new LaylaSDK();
  await layla.utils.saveFile('note.txt', new TextEncoder().encode('Hello, '));
  const result = await layla.utils.saveFile('note.txt', new TextEncoder().encode('Layla.'), false, { append: true });
  assert.equal(result.success, true);
  assert.equal(result.size, 13);
  const read = await layla.utils.readFile('note.txt');
  assert.equal(Buffer.from(read.content_base64.split(',').pop(), 'base64').toString(), 'Hello, Layla.');
});
