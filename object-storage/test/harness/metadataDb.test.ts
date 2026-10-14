import { describe, expect, it } from 'vitest';
import { MetadataDb, isWriteStatement } from '../../sim/metadataDb';

describe('harness: metadata database', () => {
  it('runs SQL with positional and named parameters, including blobs', async () => {
    const db = await MetadataDb.create();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, data BLOB)');
    const r = db.run('INSERT INTO t (name, data) VALUES (?, ?)', ['a', new Uint8Array([1, 2])]);
    expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
    db.run('INSERT INTO t (name, data) VALUES (:name, :data)', { name: 'b', data: null });
    expect(db.get<{ name: string; data: Uint8Array }>('SELECT name, data FROM t WHERE id = ?', [1])).toEqual({
      name: 'a',
      data: new Uint8Array([1, 2]),
    });
    expect(db.all('SELECT name FROM t ORDER BY name')).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(db.get('SELECT * FROM t WHERE id = 99')).toBeUndefined();
    expect(db.run('UPDATE t SET name = name || ?', ['!']).changes).toBe(2);
  });

  it('commits a transaction, and rolls it back when the callback throws', async () => {
    const db = await MetadataDb.create();
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY)');
    db.transaction(() => {
      db.run("INSERT INTO t VALUES ('a')");
      db.run("INSERT INTO t VALUES ('b')");
    });
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t VALUES ('c')");
        db.run("INSERT INTO t VALUES ('a')"); // duplicate key
      }),
    ).toThrow();
    expect(db.all('SELECT k FROM t ORDER BY k')).toEqual([{ k: 'a' }, { k: 'b' }]);
  });

  it('supports nested transactions as savepoints', async () => {
    const db = await MetadataDb.create();
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY)');
    db.transaction(() => {
      db.run("INSERT INTO t VALUES ('outer')");
      expect(() =>
        db.transaction(() => {
          db.run("INSERT INTO t VALUES ('inner')");
          throw new Error('nope');
        }),
      ).toThrow('nope');
    });
    expect(db.all('SELECT k FROM t')).toEqual([{ k: 'outer' }]);
  });

  it('rejects async transaction callbacks and rolls them back', async () => {
    const db = await MetadataDb.create();
    db.exec('CREATE TABLE t (k TEXT)');
    expect(() =>
      db.transaction((async () => {
        db.run("INSERT INTO t VALUES ('x')");
      }) as () => unknown),
    ).toThrow(/synchronous/);
    expect(db.all('SELECT k FROM t')).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it('compares text by UTF-8 bytes', async () => {
    const db = await MetadataDb.create();
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY)');
    for (const k of ['b', 'B', 'é', 'a/b', 'a-b', '😀']) db.run('INSERT INTO t VALUES (?)', [k]);
    const keys = db.all<{ k: string }>('SELECT k FROM t ORDER BY k').map((r) => r.k);
    expect(keys).toEqual(['B', 'a-b', 'a/b', 'b', 'é', '😀']);
  });

  it('classifies statements as reads or writes', () => {
    expect(isWriteStatement('SELECT 1')).toBe(false);
    expect(isWriteStatement('  select * from t')).toBe(false);
    expect(isWriteStatement('INSERT INTO t VALUES (1) RETURNING *')).toBe(true);
    expect(isWriteStatement('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false);
    expect(isWriteStatement('WITH x AS (SELECT 1) UPDATE t SET a = 1')).toBe(true);
  });
});
