/**
 * Utility APIs that do not belong to a domain-specific resource.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onSaveFileResponse,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type SaveFileResult = LaylaApiEvent_onSaveFileResponse['data'];

export class Utils {
  /**
   * Ask the native host to save base64-encoded file content.
   *
   * `contentBase64` must not include a data URI prefix.
   */
  saveFile(
    filename: string,
    contentBase64: string,
    share = false,
    options: RequestOptions = {},
  ): Promise<SaveFileResult> {
    return oneShot<SaveFileResult>(
      {
        cmd: 'save_file',
        data: {
          filename,
          content_base64: contentBase64,
          share,
        },
      },
      'on_save_file_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onSaveFileResponse).data,
      options.signal,
    );
  }
}
