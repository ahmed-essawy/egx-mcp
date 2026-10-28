import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import initial from "../../migrations/0001_initial.sql?raw";
import quoteCurrency from "../../migrations/0003_symbol_quote_currency.sql?raw";

const RETURNING_PATTERN = /RETURNING/i;

type Statement = { sql: string; args: SQLInputValue[] };

export function createSqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(initial);
  sqlite.exec(quoteCurrency);

  function runAll({ sql, args }: Statement) {
    const results = sqlite.prepare(sql).all(...args);
    return { results, meta: { rows_read: results.length, rows_written: 0 } };
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: SQLInputValue[]) {
          const statement: Statement = { sql, args };
          return {
            ...statement,
            async run() {
              if (RETURNING_PATTERN.test(sql)) {
                const { results } = runAll(statement);
                return { results, meta: { rows_read: 0, rows_written: results.length, changes: results.length } };
              }
              const info = sqlite.prepare(sql).run(...args) as { changes: number | bigint; lastInsertRowid: number | bigint };
              const changes = Number(info.changes);
              return { results: [], meta: { rows_read: 0, rows_written: changes, changes, last_row_id: Number(info.lastInsertRowid) } };
            },
            async all() {
              return runAll(statement);
            },
            async first() {
              return runAll(statement).results[0] ?? null;
            },
          };
        },
      };
    },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(runAll);
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
