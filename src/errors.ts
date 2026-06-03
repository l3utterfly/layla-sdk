/**
 * errors.ts
 * ---------
 * The error hierarchy. Everything the SDK throws or rejects with extends
 * `LaylaError`, so consumers can `catch (e) { if (e instanceof LaylaError) ... }`.
 */

export class LaylaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaylaError';
  }
}

export class LaylaAbortError extends LaylaError {
  constructor(message = 'Request was aborted') {
    super(message);
    this.name = 'LaylaAbortError';
  }
}

export class LaylaBridgeUnavailableError extends LaylaError {
  constructor() {
    super(
      'Layla bridge unavailable: window.ReactNativeWebView is not present. ' +
        'Make sure this code runs inside the Layla WebView and that the ' +
        '<WebView> has its `onMessage` prop set (that is what injects the bridge).',
    );
    this.name = 'LaylaBridgeUnavailableError';
  }
}
