/**
 * resources/cloud.ts
 * ------------------
 * The Layla Cloud resource: `layla.cloud.login()`.
 *
 * Asks the host for the access token of the Layla Cloud account signed in on
 * the device. The host owns the whole sign-in flow — it may answer immediately
 * from an existing session, or put an interactive login in front of the user
 * first — so the call can stay pending for as long as the user takes. It
 * resolves once the host emits `on_layla_cloud_login`: with the access token
 * when an account is signed in, or with `null` when the user declined.
 *
 * The token is a Bearer token for Layla Cloud HTTP APIs, which a mini-app calls
 * with ordinary `fetch` — the SDK does not proxy those requests.
 */

import type { LaylaApiEvent } from '../interface';
import type { LaylaApiEvent_onCloudLogin } from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

/** The Layla Cloud access token, or `null` when the user is not signed in. */
export type CloudLoginResult =
  LaylaApiEvent_onCloudLogin['data']['access_token'];

export class Cloud {
  /**
   * Ask the native host for the signed-in Layla Cloud account's access token,
   * prompting the user to log in when there is no session yet.
   *
   * Resolves with the access token, or `null` when the user declined to log in
   * — treat `null` as "no cloud features this session" rather than an error.
   * Rejects on host error/abort.
   *
   * Use the token as the `Authorization: Bearer <token>` header on Layla Cloud
   * API requests. Do not cache it beyond the current session: ask again when a
   * request comes back unauthorized, since the host may have refreshed or
   * dropped the session in the meantime.
   */
  login(options: RequestOptions = {}): Promise<CloudLoginResult> {
    return oneShot<CloudLoginResult>(
      { cmd: 'layla_cloud_login', data: null },
      'on_layla_cloud_login',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onCloudLogin).data.access_token,
      options.signal,
    );
  }
}
