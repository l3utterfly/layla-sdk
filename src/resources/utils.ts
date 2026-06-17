/**
 * Utility APIs that do not belong to a domain-specific resource.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onReadFileResponse,
  LaylaApiEvent_onSaveFileResponse,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type SaveFileResult = LaylaApiEvent_onSaveFileResponse['data'];
export type ReadFileResult = LaylaApiEvent_onReadFileResponse['data'];

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

  /**
   * Ask the native host to read file content from the app's private directory.
   *
   * The returned `content_base64` includes a data URI prefix when available.
   */
  readFile(
    filename: string,
    options: RequestOptions = {},
  ): Promise<ReadFileResult> {
    return oneShot<ReadFileResult>(
      {
        cmd: 'read_file',
        data: {
          filename,
        },
      },
      'on_read_file_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onReadFileResponse).data,
      options.signal,
    );
  }
}
