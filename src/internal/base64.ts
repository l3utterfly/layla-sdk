/**
 * internal/base64.ts
 * ------------------
 * Base64 encoding for byte arrays without `btoa`, `FileReader` or `Buffer`, so
 * it works the same in a WebView and in the QuickJS runtime. The output is
 * built as ASCII codes in a typed array and turned into a string in slices,
 * which keeps the intermediate garbage to one buffer of the output's size.
 */

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const PAD = '='.charCodeAt(0);
/** Characters per String.fromCharCode call; well below engine argument limits. */
const SLICE = 0x8000;

/** Standard base64 (with `=` padding) of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  const length = bytes.length;
  const out = new Uint8Array(Math.ceil(length / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = CODES[n >> 18];
    out[o++] = CODES[(n >> 12) & 63];
    out[o++] = CODES[(n >> 6) & 63];
    out[o++] = CODES[n & 63];
  }
  if (i < length) {
    const second = i + 1 < length;
    const n = (bytes[i] << 16) | (second ? bytes[i + 1] << 8 : 0);
    out[o++] = CODES[n >> 18];
    out[o++] = CODES[(n >> 12) & 63];
    out[o++] = second ? CODES[(n >> 6) & 63] : PAD;
    out[o++] = PAD;
  }

  let result = '';
  for (let s = 0; s < out.length; s += SLICE) {
    result += String.fromCharCode.apply(
      null,
      out.subarray(s, s + SLICE) as unknown as number[],
    );
  }
  return result;
}

/**
 * Base64 of a Blob's bytes. Uses the platform's FileReader where there is one
 * (a WebView): it encodes natively and holds only the output string, where
 * reading the bytes into JS first would hold the bytes, the ASCII buffer and
 * the string at once. Falls back to {@link bytesToBase64} elsewhere (QuickJS).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (blob.size === 0) return ''; // readAsDataURL yields a bare "data:" here
  if (typeof FileReader === 'undefined') {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read the file content.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Base64 of `bytes`, through {@link blobToBase64} when the platform has Blob
 * and FileReader, else in JS.
 */
export function encodeBytes(bytes: Uint8Array): Promise<string> {
  if (typeof Blob !== 'undefined' && typeof FileReader !== 'undefined') {
    return blobToBase64(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  }
  return Promise.resolve(bytesToBase64(bytes));
}

/** Decoded size in bytes of a padded base64 string. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}
