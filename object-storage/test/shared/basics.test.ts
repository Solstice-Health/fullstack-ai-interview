import { describe, expect, it } from 'vitest';
import { AWKWARD_KEYS } from '../fixtures/keys';
import { BUCKET, MiB, alice, bytes, expectBytes, isNotFound, listAll, setup, text } from '../helpers/setup';

describe('basics', () => {
  it.skip('#1 Read-after-write: a get straight after a put returns the new bytes; after an overwrite it returns the newest', async () => {
    const { client } = await setup();
    const objects: [string, Uint8Array][] = [
      ['hello.txt', text('hello')],
      ['empty.json', new Uint8Array(0)],
      ['big/video.mp4', bytes(3 * MiB + 17, 7)],
      ...AWKWARD_KEYS.map((k, i): [string, Uint8Array] => [k, text(`object ${i}: ${k}`)]),
    ];
    for (const [key, data] of objects) {
      await client.putObject(alice, BUCKET, key, data);
      expectBytes(await client.getObject(alice, BUCKET, key), data, key);
    }
    // Every key is its own object.
    for (const [key, data] of objects) expectBytes(await client.getObject(alice, BUCKET, key), data, key);

    for (let i = 1; i <= 5; i++) {
      const data = bytes(10_000 + i, 100 + i);
      await client.putObject(alice, BUCKET, 'brochure.pdf', data);
      expectBytes(await client.getObject(alice, BUCKET, 'brochure.pdf'), data, `overwrite ${i}`);
    }
  });

  it.skip('#2 Versioning: three puts create three versions, each readable by versionId; a delete adds a marker so the latest returns 404 while older versions still read', async () => {
    const { client } = await setup();
    const key = 'brand/logo.png';
    const data = [bytes(5000, 1), bytes(7000, 2), bytes(6000, 3)];
    const ids: string[] = [];
    for (const d of data) ids.push((await client.putObject(alice, BUCKET, key, d)).versionId);
    expect(new Set(ids).size).toBe(3);
    for (let i = 0; i < 3; i++) {
      expectBytes(await client.getObject(alice, BUCKET, key, { versionId: ids[i] }), data[i]!, `version ${i + 1}`);
    }
    expectBytes(await client.getObject(alice, BUCKET, key), data[2]!, 'latest');

    expect(await client.deleteObject(alice, BUCKET, key)).toEqual({ deleteMarker: true });
    expect(await isNotFound(client.getObject(alice, BUCKET, key))).toBe(true);
    for (let i = 0; i < 3; i++) {
      expectBytes(await client.getObject(alice, BUCKET, key, { versionId: ids[i] }), data[i]!, `version ${i + 1} after delete`);
    }
    expect(await listAll(client, alice, BUCKET, '')).toEqual([]);

    // A new put makes the key visible again.
    const d4 = bytes(4000, 4);
    await client.putObject(alice, BUCKET, key, d4);
    expectBytes(await client.getObject(alice, BUCKET, key), d4, 'after re-put');
    expect(await listAll(client, alice, BUCKET, '')).toEqual([key]);

    // Deleting a specific version removes only that version.
    expect(await client.deleteObject(alice, BUCKET, key, { versionId: ids[1] })).toEqual({ deleteMarker: false });
    expect(await isNotFound(client.getObject(alice, BUCKET, key, { versionId: ids[1] }))).toBe(true);
    expectBytes(await client.getObject(alice, BUCKET, key, { versionId: ids[0] }), data[0]!, 'version 1 after removing version 2');
    expectBytes(await client.getObject(alice, BUCKET, key), d4, 'latest after removing version 2');

    expect(await isNotFound(client.getObject(alice, BUCKET, 'never-written'))).toBe(true);
  });
});
