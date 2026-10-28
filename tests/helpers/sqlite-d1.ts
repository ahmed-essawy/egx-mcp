import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import initial from "../../migrations/0001_initial.sql?raw";
import quoteCurrency from "../../migrations/0003_symbol_quote_currency.sql?raw";

const RETURNING_PATTERN = /RETURNING/i;
const READ_PATTERN = /^\s*(SELECT|WITH|PRAGMA)\b/i;

const MUTATION_TABLE_PATTERN = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+"?(\w+)"?/i;
const PRIMARY_KEY_ORIGIN = "pk";

type Statement = { sql: string; args: SQLInputValue[] };

export function createSqliteD1(): { db: D1Database; sqlite: DatabaseSync; rowsWritten: () => number; rowsWrittenTo: (table: string) => number } {
  let written = 0;
  const writtenByTable = new Map<string, number>();
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(initial);
  sqlite.exec(quoteCurrency);

  function runAll({ sql, args }: Statement) {
    const results = sqlite.prepare(sql).all(...args);
    const rowsWritten = RETURNING_PATTERN.test(sql) ? rowsWrittenBy(sql, results.length) : 0;
    written += rowsWritten;
    return { results, meta: { rows_read: results.length, rows_written: rowsWritten } };
  }

  const indexCounts = new Map<string, number>();

  function secondaryIndexCount(table: string): number {
    const cached = indexCounts.get(table);
    if (cached !== undefined) return cached;
    const isWithoutRowid = (sqlite.prepare("SELECT wr FROM pragma_table_list(?1)").get(table) as { wr: number } | undefined)?.wr === 1;
    const indexes = sqlite.prepare("SELECT origin FROM pragma_index_list(?1)").all(table) as { origin: string }[];
    const count = indexes.filter((index) => !(isWithoutRowid && index.origin === PRIMARY_KEY_ORIGIN)).length;
    indexCounts.set(table, count);
    return count;
  }

  function rowsWrittenBy(sql: string, changes: number): number {
    const table = MUTATION_TABLE_PATTERN.exec(sql)?.[1];
    if (table === undefined) return changes;
    const rows = changes * (1 + secondaryIndexCount(table));
    writtenByTable.set(table, (writtenByTable.get(table) ?? 0) + rows);
    return rows;
  }

  function runMutation({ sql, args }: Statement) {
    if (READ_PATTERN.test(sql) || RETURNING_PATTERN.test(sql)) return runAll({ sql, args });
    const info = sqlite.prepare(sql).run(...args) as { changes: number | bigint; lastInsertRowid: number | bigint };
    const changes = Number(info.changes);
    const rowsWritten = rowsWrittenBy(sql, changes);
    written += rowsWritten;
    return { results: [], meta: { rows_read: 0, rows_written: rowsWritten, changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  function bound(sql: string, args: SQLInputValue[]) {
    const statement: Statement = { sql, args };
    return {
      ...statement,
      async run() {
        return runMutation(statement);
      },
      async all() {
        return runAll(statement);
      },
      async first() {
        return runAll(statement).results[0] ?? null;
      },
    };
  }

  const db = {
    prepare(sql: string) {
      return {
        ...bound(sql, []),
        bind(...args: SQLInputValue[]) {
          return bound(sql, args);
        },
      };
    },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(runMutation);
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite, rowsWritten: () => written, rowsWrittenTo: (table) => writtenByTable.get(table) ?? 0 };
}
