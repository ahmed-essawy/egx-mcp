declare module "node:sqlite" {
  export type SQLInputValue = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    run(...params: SQLInputValue[]): { changes: number | bigint };
    all(...params: SQLInputValue[]): unknown[];
    get(...params: SQLInputValue[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
