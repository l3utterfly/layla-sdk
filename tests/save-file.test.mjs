// Run after npm run build: node --test tests/save-file.test.mjs
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LaylaSDK, SAVE_FILE_PART_BYTES, installLaylaMock } from '../dist/index.js';

globalThis.window = new EventTarget();
let mock;
afterEach(() => {
  mock?.uninstall();
  mock = undefined;
});

function bytes(length, seed = 7) {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const b64 = (u8) => Buffer.from(u8).toString('base64');

/** A host store behind the mock's saveFile hook; `appends` false = older host. */
function host({ appends }) {
  const files = new Map();
  const calls = [];
  const saveFile = ({ filename, contentBase64, share, append }) => {
    calls.push({ append, share, bytes: Buffer.from(contentBase64, 'base64').length });
    const part = Buffer.from(contentBase64, 'base64');
    const next = appends && append ? Buffer.concat([files.get(filename) ?? Buffer.alloc(0), part]) : part;
    files.set(filename, next);
    return { filename, success: true, ...(appends ? { size: next.length } : {}) };
  };
  return { files, calls, saveFile };
}

test('encodes bytes exactly, for every padding case', async () => {
  const store = host({ appends: true });
  mock = installLaylaMock({ latencyMs: 0, saveFile: store.saveFile });
  const layla = new LaylaSDK();
  for (const length of [0, 1, 2, 3, 4, 5, 100, 65537]) {
    const data = bytes(length, length + 1);
    const result = await layla.utils.saveFile(`f${length}`, data);
    assert.equal(result.success, true);
    assert.deepEqual(new Uint8Array(store.files.get(`f${length}`)), data, `length ${length}`);
  }
  assert.ok(store.calls.every((c) => !c.append && !c.share), 'small files go in one message');
});

test('sends large files in parts and shares only with the last one', async () => {
  const store = host({ appends: true });
  mock = installLaylaMock({ latencyMs: 0, saveFile: store.saveFile });
  const layla = new LaylaSDK();
  const data = bytes(SAVE_FILE_PART_BYTES * 2 + 12345);

  for (const [name, content] of [
    ['typed', data],
    ['view', new DataView(data.buffer)],
    ['blob', new Blob([data])],
    ['base64', b64(data)],
  ]) {
    store.calls.length = 0;
    const result = await layla.utils.saveFile(`${name}.zip`, content, true);
    assert.equal(result.success, true, name);
    assert.equal(result.size, data.length, name);
    assert.deepEqual(new Uint8Array(store.files.get(`${name}.zip`)), data, name);
    assert.deepEqual(
      store.calls.map(({ append, share }) => ({ append, share })),
      [
        { append: false, share: false },
        { append: true, share: false },
        { append: true, share: true },
      ],
      name,
    );
    assert.ok(store.calls.every((c) => c.bytes <= SAVE_FILE_PART_BYTES), name);
  }
});

test('falls back to one message on a host that does not report size', async () => {
  const store = host({ appends: false });
  mock = installLaylaMock({ latencyMs: 0, saveFile: store.saveFile });
  const layla = new LaylaSDK();
  const data = bytes(SAVE_FILE_PART_BYTES + 10);

  const result = await layla.utils.saveFile('old.zip', data, true);

  assert.equal(result.success, true);
  assert.deepEqual(new Uint8Array(store.files.get('old.zip')), data);
  assert.deepEqual(store.calls, [
    { append: false, share: false, bytes: SAVE_FILE_PART_BYTES },
    { append: false, share: true, bytes: data.length },
  ]);
});

test('stops at the first failed part', async () => {
  let n = 0;
  mock = installLaylaMock({
    latencyMs: 0,
    saveFile: ({ filename }) => (++n === 2 ? { filename, success: false, message: 'disk full' } : { filename, success: true, size: n }),
  });
  const result = await new LaylaSDK().utils.saveFile('x.bin', bytes(SAVE_FILE_PART_BYTES * 3), true);
  assert.deepEqual(result, { filename: 'x.bin', success: false, message: 'disk full' });
  assert.equal(n, 2);
});

/** A browser-like localStorage that refuses values over `quota` characters. */
function smallLocalStorage(quota) {
  const items = new Map();
  return {
    get length() { return items.size; },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > quota) throw new Error('QuotaExceededError');
      items.set(k, v);
    },
    removeItem: (k) => items.delete(k),
  };
}

test('the default mock store assembles parts and reads them back', async () => {
  window.atob = atob;
  window.localStorage = smallLocalStorage(1024 * 1024);
  mock = installLaylaMock({ latencyMs: 0 });
  const layla = new LaylaSDK();
  const data = bytes(SAVE_FILE_PART_BYTES + 99);

  const saved = await layla.utils.saveFile('exports/big.zip', data);
  assert.equal(saved.success, true);
  assert.equal(saved.size, data.length);
  assert.match(saved.message, /in memory/);
  await layla.utils.saveFile('exports/small.txt', b64(Buffer.from('hi')));
  assert.equal(window.localStorage.length, 1, 'small files still go to localStorage');

  const read = await layla.utils.readFile('exports/big.zip');
  assert.equal(read.content_base64, `data:application/octet-stream;base64,${b64(data)}`);
  assert.deepEqual(await layla.utils.listDir('exports'), [
    { path: 'exports/big.zip', is_dir: false },
    { path: 'exports/small.txt', is_dir: false },
  ]);

  await layla.utils.deleteFileOrDir('exports');
  assert.equal((await layla.utils.readFile('exports/big.zip')).content_base64, null);
  assert.equal(window.localStorage.length, 0);
  delete window.localStorage;
});

test('uses the platform FileReader when there is one', async () => {
  let reads = 0;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      reads++;
      blob.arrayBuffer().then((buf) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
        this.onload();
      });
    }
  };
  try {
    const store = host({ appends: false });
    mock = installLaylaMock({ latencyMs: 0, saveFile: store.saveFile });
    const layla = new LaylaSDK();
    const data = bytes(SAVE_FILE_PART_BYTES + 5);

    for (const content of [new Blob([data]), data]) {
      reads = 0;
      store.calls.length = 0;
      const result = await layla.utils.saveFile('fr.zip', content, true);
      assert.equal(result.success, true);
      assert.deepEqual(new Uint8Array(store.files.get('fr.zip')), data);
      assert.equal(reads, 2, 'first part and the one-message fallback');
    }
    const empty = await layla.utils.saveFile('empty.bin', new Blob([]));
    assert.equal(empty.success, true);
    assert.equal(store.files.get('empty.bin').length, 0);
  } finally {
    delete globalThis.FileReader;
  }
});
