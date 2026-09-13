/**
 * internal/host-version.ts
 * ------------------------
 * Host capability detection from the Layla app version.
 *
 * The host's protocol grows over time, so some commands only exist on newer
 * builds. The app version reported in the execution context is the only thing
 * the SDK can key that off, and it arrives asynchronously — so the probe is
 * done once and memoised, and every call site awaits the same answer.
 */

import { getExecutionContext } from './execution-context';

export interface HostVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * The host reports its version as `7.5.0`, `v7.5.0`, or `v7.5.0-alpha1`; the
 * leading `v` and any pre-release/build suffix are optional, and the patch
 * component may be missing on an early tag.
 */
const APP_VERSION = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?/i;

export function parseHostVersion(
  raw: string | null | undefined,
): HostVersion | null {
  if (typeof raw !== 'string') return null;
  const match = APP_VERSION.exec(raw);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/**
 * `send_message_v2` — the command that carries the untranslated OpenAI request
 * body — landed in Layla 7.5.0. Any 7.5.0 build counts, pre-release tags
 * (`v7.5.0-alpha1`) included. An unparseable or absent version is treated as
 * an older host.
 */
export function supportsSendMessageV2(version: HostVersion | null): boolean {
  if (!version) return false;
  return version.major > 7 || (version.major === 7 && version.minor >= 5);
}

/**
 * How long to wait for the host to report its version before assuming it is an
 * old one. A host that predates `get_execution_context` never answers it at
 * all, and a chat completion must not hang waiting on a reply that will never
 * come.
 */
const VERSION_PROBE_TIMEOUT_MS = 2000;

/** The memoised answer: one probe per session, shared by every caller. */
let sendMessageV2Support: Promise<boolean> | null = null;

/**
 * Resolve once with whether this host understands `send_message_v2`.
 *
 * Never rejects: a host that errors or stays silent is treated as an old one
 * and served by the original `send_message` path. The outcome is cached either
 * way, so only the first chat completion of a session pays for the probe.
 */
export function hostSupportsSendMessageV2(): Promise<boolean> {
  if (!sendMessageV2Support) {
    sendMessageV2Support = new Promise<boolean>((resolve) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => resolve(false),
        VERSION_PROBE_TIMEOUT_MS,
      );
      getExecutionContext().then(
        (context) => {
          clearTimeout(timer);
          resolve(supportsSendMessageV2(parseHostVersion(context.app_version)));
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
    });
  }
  return sendMessageV2Support;
}
