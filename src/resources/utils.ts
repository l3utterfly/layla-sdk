/**
 * Utility APIs that do not belong to a domain-specific resource.
 */

import type { LaylaApiEvent } from '../interface';
import type {
  LaylaApiEvent_onCancelScheduledNotificationResponse,
  LaylaApiEvent_onGetScheduledNotificationsResponse,
  LaylaApiEvent_onReadFileResponse,
  LaylaApiEvent_onScheduleNotificationResponse,
  LaylaApiEvent_onSaveFileResponse,
  LaylaApiEvent_onListDirResponse,
  LaylaApiEvent_onDeleteFileOrDirResponse,
  LaylaApiScheduleNotification,
  LaylaScheduledNotification,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';
import {
  base64ByteLength,
  blobToBase64,
  encodeBytes,
} from '../internal/base64';

/** File content for `saveFile`: base64 text (no data URI prefix) or raw bytes. */
export type SaveFileContent = string | Blob | ArrayBuffer | ArrayBufferView;

/**
 * Raw bytes per `save_file` message when a file is sent in parts (4 MiB of
 * base64, which the host decodes in one step).
 */
export const SAVE_FILE_PART_BYTES = 3 * 1024 * 1024;
const PART_BASE64_CHARS = (SAVE_FILE_PART_BYTES / 3) * 4;

interface SaveSource {
  byteLength: number;
  parts: number;
  /** Base64 of part `index`. */
  part(index: number): Promise<string>;
  /** Base64 of the whole file. */
  whole(): Promise<string>;
}

function toSaveSource(content: SaveFileContent): SaveSource {
  if (typeof content === 'string') {
    return {
      byteLength: base64ByteLength(content),
      parts: Math.max(1, Math.ceil(content.length / PART_BASE64_CHARS)),
      part: async (i) =>
        content.substring(i * PART_BASE64_CHARS, (i + 1) * PART_BASE64_CHARS),
      whole: async () => content,
    };
  }

  const parts = (byteLength: number) =>
    Math.max(1, Math.ceil(byteLength / SAVE_FILE_PART_BYTES));
  const start = (i: number) => i * SAVE_FILE_PART_BYTES;

  if (typeof Blob !== 'undefined' && content instanceof Blob) {
    return {
      byteLength: content.size,
      parts: parts(content.size),
      part: (i) => blobToBase64(content.slice(start(i), start(i + 1))),
      whole: () => blobToBase64(content),
    };
  }

  const bytes = ArrayBuffer.isView(content)
    ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    : new Uint8Array(content as ArrayBuffer);
  return {
    byteLength: bytes.length,
    parts: parts(bytes.length),
    part: (i) => encodeBytes(bytes.subarray(start(i), start(i + 1))),
    whole: () => encodeBytes(bytes),
  };
}

export type SaveFileResult = LaylaApiEvent_onSaveFileResponse['data'];
export type ReadFileResult = LaylaApiEvent_onReadFileResponse['data'];
export type ListDirResult = LaylaApiEvent_onListDirResponse['data'];
export type DeleteFileOrDirResult =
  LaylaApiEvent_onDeleteFileOrDirResponse['data'];
export type ScheduleNotificationParams = Omit<
  LaylaApiScheduleNotification['data'],
  'icon'
> & {
  /** Relative image path inside the mini-app, or null for its default icon. */
  icon?: string | null;
};
export type ScheduleNotificationResult = LaylaScheduledNotification;
export type GetScheduledNotificationsResult = LaylaScheduledNotification[];
export type CancelScheduledNotificationResult =
  LaylaApiEvent_onCancelScheduledNotificationResponse['data'];

export class Utils {
  /**
   * Schedule a one-time notification for the calling mini-app.
   *
   * `timestamp` is a future Unix timestamp in milliseconds. `icon`, when
   * provided, is an image path relative to the mini-app folder; omit it or pass
   * `null` to use the mini-app's default icon.
   */
  scheduleNotification(
    notification: ScheduleNotificationParams,
    options: RequestOptions = {},
  ): Promise<ScheduleNotificationResult> {
    return oneShot<ScheduleNotificationResult>(
      {
        cmd: 'schedule_notification',
        data: {
          icon: notification.icon ?? null,
          message: notification.message,
          timestamp: notification.timestamp,
        },
      },
      'on_schedule_notification_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onScheduleNotificationResponse).data,
      options.signal,
    );
  }

  /** Fetch all pending notifications scheduled by the calling mini-app. */
  getScheduledNotifications(
    options: RequestOptions = {},
  ): Promise<GetScheduledNotificationsResult> {
    return oneShot<GetScheduledNotificationsResult>(
      { cmd: 'get_scheduled_notifications', data: null },
      'on_get_scheduled_notifications_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetScheduledNotificationsResponse).data
          .scheduled_notifications ?? [],
      options.signal,
    );
  }

  /** Cancel a pending notification by its host-assigned ID. */
  cancelScheduledNotification(
    id: string,
    options: RequestOptions = {},
  ): Promise<CancelScheduledNotificationResult> {
    return oneShot<CancelScheduledNotificationResult>(
      { cmd: 'cancel_scheduled_notification', data: { id } },
      'on_cancel_scheduled_notification_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onCancelScheduledNotificationResponse).data,
      options.signal,
    );
  }

  /**
   * Ask the native host to save a file in the app's private directory, and
   * optionally offer it in the share sheet afterwards.
   *
   * `content` is either a base64 string (without a data URI prefix) or the raw
   * bytes as a `Blob`, `ArrayBuffer` or typed array. Prefer passing bytes for
   * large files: the SDK then encodes one part at a time instead of holding
   * the whole file as a base64 string.
   *
   * Files over {@link SAVE_FILE_PART_BYTES} are sent in parts, so no single
   * WebView message carries the whole file. A message that large briefly
   * exists in several copies at once, and on iOS that can exceed the memory
   * limit for the web page; iOS then ends the page, which shows as a blank
   * screen. On a Layla build that predates split saves, the SDK falls back to
   * one message.
   */
  async saveFile(
    filename: string,
    content: SaveFileContent,
    share = false,
    options: RequestOptions = {},
  ): Promise<SaveFileResult> {
    const source = toSaveSource(content);
    const send = (contentBase64: string, shareNow: boolean, append: boolean) =>
      oneShot<SaveFileResult>(
        {
          cmd: 'save_file',
          data: {
            filename,
            content_base64: contentBase64,
            share: shareNow,
            ...(append ? { append: true } : {}),
          },
        },
        'on_save_file_response',
        (event: LaylaApiEvent) =>
          (event as LaylaApiEvent_onSaveFileResponse).data,
        options.signal,
      );

    if (source.parts <= 1) return send(await source.whole(), share, false);

    // The first part replaces the file on every host. Only a host that honours
    // `append` reports `size`; an older one would overwrite the file with each
    // later part, so it gets the whole file in one message instead.
    const first = await send(await source.part(0), false, false);
    if (typeof first.size !== 'number') {
      return send(await source.whole(), share, false);
    }
    let result = first;
    for (let i = 1; i < source.parts && result.success; i++) {
      const last = i === source.parts - 1;
      result = await send(await source.part(i), last && share, true);
    }
    if (result.success && result.size !== source.byteLength) {
      return {
        filename,
        success: false,
        message: `Saved ${result.size} of ${source.byteLength} bytes; another write to ${filename} may have interleaved.`,
      };
    }
    return result;
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
