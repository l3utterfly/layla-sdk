import { LaylaSDK, type SaveFileOptions, type SaveFileResult } from '../src';

const layla = new LaylaSDK();
const options: SaveFileOptions = { append: true, signal: new AbortController().signal };
const appended: Promise<SaveFileResult> = layla.utils.saveFile('a.bin', new Uint8Array(4), false, options);
const replaced: Promise<SaveFileResult> = layla.utils.saveFile('a.bin', new Blob(['x']), true);

// @ts-expect-error append is a boolean
layla.utils.saveFile('a.bin', 'AAAA', false, { append: 'yes' });

void appended;
void replaced;
