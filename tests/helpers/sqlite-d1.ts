import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import initial from "../../migrations/0001_initial.sql?raw";
import quoteCurrency from "../../migrations/0003_symbol_quote_currency.sql?raw";

type Statement = { sql: string; args: SQLInputValue[] };

export function createSqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(initial);
  sqlite.exec(quoteCurrency);

  function runAll({ sql, args }: Statement) {
    return { results: sqlite.prepare(sql).all(...args), meta: { rows_written: 0 } };
  }

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: SQLInputValue[]) {
          const statement: Statement = { sql, args };
          return {
            ...statement,
            async run() {
              const info = sqlite.prepare(sql).run(...args);
              return { meta: { rows_written: Number(info.changes) } };
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
