import type { BaseApiEvent, BaseApiRequest } from "./protocol";
import type { TypescriptApiEvent } from "./typescript-protocol";

export type LaylaApiRequest = BaseApiRequest;
export type LaylaApiEvent = BaseApiEvent | TypescriptApiEvent;

export type Emit = (requestId: string, event: LaylaApiEvent) => void;

export type LogLevel = 'log' | 'warn' | 'error';

/**
 * Sink for API trace lines. When supplied to {@link LaylaApiService}, the
 * service routes its internal traces here instead of straight to `console`,
 * allowing the host (e.g. a screen) to persist them to a file.
 */
export type LogCallback = (level: LogLevel, message: string, data?: unknown) => void;