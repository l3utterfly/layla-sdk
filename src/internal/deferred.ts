/**
 * internal/deferred.ts
 * --------------------
 * A promise whose resolve/reject are exposed, so other code can settle it later.
 */

export class Deferred<T> {
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;
  readonly promise: Promise<T>;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}
