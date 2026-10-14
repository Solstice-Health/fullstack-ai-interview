/**
 * In-memory SQL database standing in for Postgres. It is SQLite (via sql.js,
 * compiled to WebAssembly), so use SQLite syntax.
 *
 * The API is synchronous. A transaction runs a synchronous callback: either
 * every statement in it commits, or none does. You cannot await inside a
 * transaction.
 */
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, Statement } from 'sql.js';

export type SqlParam = string | number | bigint | boolean | Uint8Array | null;
/** Positional (`?`) parameters as an array, or named (`:name`, `$name`, `@name`) as an object without the prefix. */
export type SqlParams = readonly SqlParam[] | Readonly<Record<string, SqlParam>>;
export type Row = Record<string, string | number | Uint8Array | null>;

export interface RunResult {
  /** Rows inserted, updated or deleted by the statement. */
  changes: number;
  /** Rowid of the last inserted row. */
  lastInsertRowid: number;
}

/** What the server sees. */
export interface SqlDatabase {
  /** Runs one or more statements with no parameters (DDL, migrations). */
  exec(sql: string): void;
  /** Runs a statement that returns no rows. */
  run(sql: string, params?: SqlParams): RunResult;
  /** Runs a query and returns the first row, or undefined. */
  get<T = Row>(sql: string, params?: SqlParams): T | undefined;
  /** Runs a query and returns every row. */
  all<T = Row>(sql: string, params?: SqlParams): T[];
  /**
   * Runs `fn` in a transaction. Commits if `fn` returns, rolls back if it throws.
   * `fn` must be synchronous. Nested calls use savepoints.
   */
  transaction<T>(fn: () => T): T;
}

let sqlJs: Promise<SqlJsStatic> | null = null;
function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJs ??= initSqlJs();
  return sqlJs;
}

export class MetadataDb implements SqlDatabase {
  private depth = 0;
  private savepointSeq = 0;

  private constructor(private readonly db: Database) {
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  static async create(): Promise<MetadataDb> {
    const SQL = await loadSqlJs();
    return new MetadataDb(new SQL.Database());
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params?: SqlParams): RunResult {
    const stmt = this.prepare(sql, params);
    try {
      while (stmt.step()) {
        /* drain */
      }
    } finally {
      stmt.free();
    }
    const changes = this.db.getRowsModified();
    const last = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0];
    return { changes, lastInsertRowid: Number(last ?? 0) };
  }

  get<T = Row>(sql: string, params?: SqlParams): T | undefined {
    const stmt = this.prepare(sql, params);
    try {
      return stmt.step() ? (stmt.getAsObject() as T) : undefined;
    } finally {
      stmt.free();
    }
  }

  all<T = Row>(sql: string, params?: SqlParams): T[] {
    const stmt = this.prepare(sql, params);
    const rows: T[] = [];
    try {
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
    } finally {
      stmt.free();
    }
    return rows;
  }

  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const savepoint = `sp_${++this.savepointSeq}`;
    this.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.depth += 1;
    let result: T;
    try {
      result = fn();
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('transaction callback must be synchronous (it returned a Promise)');
      }
    } catch (err) {
      this.depth -= 1;
      this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw err;
    }
    this.depth -= 1;
    this.db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  }

  close(): void {
    this.db.close();
  }

  private prepare(sql: string, params?: SqlParams): Statement {
    const stmt = this.db.prepare(sql);
    try {
      if (params !== undefined) stmt.bind(toBindParams(params));
    } catch (err) {
      stmt.free();
      throw err;
    }
    return stmt;
  }
}

type SqlValue = string | number | Uint8Array | null;

function toValue(v: SqlParam): SqlValue {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function toBindParams(params: SqlParams): SqlValue[] | Record<string, SqlValue> {
  if (Array.isArray(params)) return (params as readonly SqlParam[]).map(toValue);
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params as Record<string, SqlParam>)) {
    const value = toValue(v);
    if (/^[:$@]/.test(k)) out[k] = value;
    else {
      out[`:${k}`] = value;
      out[`$${k}`] = value;
      out[`@${k}`] = value;
    }
  }
  return out;
}

const READ_ONLY = /^\s*(select|pragma|explain|values)\b/i;
const WRITE_WORD = /\b(insert|update|delete|replace|create|drop|alter)\b/i;

/** True if the SQL statement may modify the database. Used to classify crash steps. */
export function isWriteStatement(sql: string): boolean {
  if (READ_ONLY.test(sql)) return false;
  if (/^\s*with\b/i.test(sql)) return WRITE_WORD.test(sql);
  return true;
}
