import { describe, expect, it } from 'vitest';
import { AWKWARD_KEYS, PREFIX_KEYS } from '../fixtures/keys';
import { BUCKET, alice, byUtf8, inParallel, listAll, setup, text } from '../helpers/setup';

describe('LIST', () => {
  it.skip('#8 LIST pagination: 2,500 keys listed 1,000 at a time give 3 pages with no duplicates or gaps, even when keys are added between pages', async () => {
    const { client } = await setup();
    const keys = [
      ...AWKWARD_KEYS,
      ...Array.from({ length: 2500 - AWKWARD_KEYS.length }, (_, i) => `photos/${String(i).padStart(4, '0')}.jpg`),
    ];
    await inParallel(keys, 50, (k) => client.putObject(alice, BUCKET, k, text(k)));
    const expected = [...keys].sort(byUtf8);

    const p1 = await client.listObjects(alice, BUCKET, '', { limit: 1000 });
    expect(p1.keys).toHaveLength(1000);
    expect(p1.nextCursor).toBeDefined();
    const p2 = await client.listObjects(alice, BUCKET, '', { limit: 1000, cursor: p1.nextCursor });
    expect(p2.keys).toHaveLength(1000);
    expect(p2.nextCursor).toBeDefined();
    const p3 = await client.listObjects(alice, BUCKET, '', { limit: 1000, cursor: p2.nextCursor });
    expect(p3.keys).toHaveLength(500);
    expect(p3.nextCursor).toBeUndefined();
    expect([...p1.keys, ...p2.keys, ...p3.keys]).toEqual(expected);

    // Keys added between pages: before the cursor, and after it.
    const seen: string[] = [];
    const page1 = await client.listObjects(alice, BUCKET, '', { limit: 1000 });
    seen.push(...page1.keys);
    await client.putObject(alice, BUCKET, '!added-first', text('x'));
    await client.putObject(alice, BUCKET, 'photos/0001.jpg-added', text('x'));
    await client.putObject(alice, BUCKET, 'zzz/added-last', text('x'));
    let cursor = page1.nextCursor;
    let pages = 1;
    while (cursor) {
      const page = await client.listObjects(alice, BUCKET, '', { limit: 1000, cursor });
      seen.push(...page.keys);
      cursor = page.nextCursor;
      pages += 1;
      if (pages === 2) await client.putObject(alice, BUCKET, 'photos/1999.jpg-added', text('x'));
      expect(pages).toBeLessThan(10);
    }
    expect(new Set(seen).size, 'no key listed twice').toBe(seen.length);
    for (const k of keys) expect(seen, `missing ${k}`).toContain(k);
    expect(seen).toContain('zzz/added-last');
    expect(seen).toEqual([...seen].sort(byUtf8));
  });

  it.skip('#9 LIST prefix: a prefix of report matches report/a and report-2, but report/ does not match report-2', async () => {
    const { client } = await setup();
    const keys = [...PREFIX_KEYS, ...AWKWARD_KEYS];
    for (const k of keys) await client.putObject(alice, BUCKET, k, text(k));
    const expectPrefix = async (prefix: string, limit = 1000) => {
      const want = keys.filter((k) => k.startsWith(prefix)).sort(byUtf8);
      expect(await listAll(client, alice, BUCKET, prefix, limit), `prefix ${JSON.stringify(prefix)}`).toEqual(want);
    };

    expect(await listAll(client, alice, BUCKET, 'report')).toEqual(
      ['report', 'report-2', 'report/a', 'report/b/c', 'report_2', 'reports', 'reportx'].sort(byUtf8),
    );
    expect(await listAll(client, alice, BUCKET, 'report/')).toEqual(['report/a', 'report/b/c']);
    for (const prefix of ['', 'report', 'report/', 'report-', 'report_', 'repo', 'folder', 'folder/', '../', 'a/', '100%', 'résum', 'nothing-here']) {
      await expectPrefix(prefix);
    }
    await expectPrefix('report', 2);
    await expectPrefix('', 3);
  });
});
