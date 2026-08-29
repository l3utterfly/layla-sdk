/**
 * Utility APIs that do not belong to a domain-specific resource.
 */

import type { LaylaApiEvent } from '../interface';
import type {
  LaylaApiEvent_onReadFileResponse,
  LaylaApiEvent_onSaveFileResponse,
  LaylaApiEvent_onListDirResponse,
  LaylaApiEvent_onDeleteFileOrDirResponse,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type SaveFileResult = LaylaApiEvent_onSaveFileResponse['data'];
export type ReadFileResult = LaylaApiEvent_onReadFileResponse['data'];
export type ListDirResult = LaylaApiEvent_onListDirResponse['data'];
export type DeleteFileOrDirResult =
  LaylaApiEvent_onDeleteFileOrDirResponse['data'];

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

  /**
   * Ask the native host to list the contents of a directory in the app's
   * private storage.
   *
   * `path` is relative to the app's private directory (use `''` or `'.'` for
   * the root). Resolves with an array of entries, each with the entry's `path`
   * (relative to the private directory) and an `is_dir` flag. Recurse into any
   * entry whose `is_dir` is `true` to walk the tree.
   */
  listDir(
    path: string,
    options: RequestOptions = {},
  ): Promise<ListDirResult> {
    return oneShot<ListDirResult>(
      {
        cmd: 'list_dir',
        data: {
          path,
        },
      },
      'on_list_dir_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onListDirResponse).data,
      options.signal,
    );
  }

  /**
   * Ask the native host to delete a file or directory in the app's private
   * storage.
   *
   * `path` is relative to the app's private directory. Deleting a directory
   * removes its contents as well. Resolves once the host confirms the deletion
   * with `on_delete_file_or_dir_response`, or rejects on error/abort.
   */
  deleteFileOrDir(
    path: string,
    options: RequestOptions = {},
  ): Promise<DeleteFileOrDirResult> {
    return oneShot<DeleteFileOrDirResult>(
      {
        cmd: 'delete_file_or_dir',
        data: {
          path,
        },
      },
      'on_delete_file_or_dir_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onDeleteFileOrDirResponse).data,
      options.signal,
    );
  }
}
