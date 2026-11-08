declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): { changes: number };
      get(...params: unknown[]): unknown;
    };
    close(): void;
  }
}
