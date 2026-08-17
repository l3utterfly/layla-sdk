/**
 * resources/db.ts
 * ---------------
 * The database resource: `layla.db.executeSql()`.
 *
 * Runs a SQL statement against a private, per-mini-app sqlite database owned by
 * the host. The database is not shared with the Layla app or with other
 * mini-apps; it is created on demand for the API caller. The call resolves with
 * the query result (`rows` for reads, `rowsAffected`/`insertId` for writes) once
 * the host emits `on_execute_sql_response`, or rejects on error/abort.
 */

import type { LaylaApiEvent } from '../interface';
import type { LaylaApiEvent_onExecuteSqlResponse } from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type ExecuteSqlResult = LaylaApiEvent_onExecuteSqlResponse['data'];

export class DB {
  /**
   * Ask the native host to run a SQL statement against the mini-app's private
   * sqlite database. Use `?` placeholders in `query` and pass their values in
   * `params` to bind them safely rather than interpolating into the SQL string.
   *
   * Resolves with the host's result: `rows` holds the rows returned by a read
   * (empty for writes), `rowsAffected` is the number of rows changed by an
   * INSERT/UPDATE/DELETE, and `insertId` is the row id of the last inserted row
   * (0 when not applicable).
   */
  executeSql(
    query: string,
    params?: unknown[],
    options: RequestOptions = {},
  ): Promise<ExecuteSqlResult> {
    return oneShot<ExecuteSqlResult>(
      {
        cmd: 'execute_sql',
        data: {
          query,
          params,
        },
      },
      'on_execute_sql_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onExecuteSqlResponse).data,
      options.signal,
    );
  }
}
