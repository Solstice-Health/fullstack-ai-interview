import { describe, expect, it } from 'vitest';
import type { ObjectStoreApi } from '../../src/objectStore';
import { ConnectionDroppedError, ResponseLostError, TestClient, retrying } from '../helpers/testClient';

function fakeStore() {
  let completes = 0;
  let parts = 0;
  const store = {
    completeMultipartUpload: async () => ({ versionId: `v${++completes}` }),
    uploadPart: async () => ({ etag: `e${++parts}` }),
    listParts: async () => [],
  } as unknown as ObjectStoreApi;
  return { store, counts: () => ({ completes, parts }) };
}

describe('harness: test client', () => {
  it('by default loses the response to the first completeMultipartUpload, after the store processed it', async () => {
    const { store, counts } = fakeStore();
    const client = new TestClient(store);
    await expect(client.completeMultipartUpload('u', [])).rejects.toBeInstanceOf(ResponseLostError);
    expect(counts().completes).toBe(1);
    expect(client.lost).toEqual([{ method: 'completeMultipartUpload', result: { versionId: 'v1' } }]);
    expect(await client.completeMultipartUpload('u', [])).toEqual({ versionId: 'v2' });
  });

  it('lostResponses can be configured or turned off', async () => {
    const { store } = fakeStore();
    const client = new TestClient(store, { lostResponses: {} });
    expect(await client.completeMultipartUpload('u', [])).toEqual({ versionId: 'v1' });
    const lossy = new TestClient(store, { lostResponses: { uploadPart: 2 } });
    await expect(lossy.uploadPart('u', 1, new Uint8Array(), '')).rejects.toBeInstanceOf(ResponseLostError);
    await expect(lossy.uploadPart('u', 1, new Uint8Array(), '')).rejects.toBeInstanceOf(ResponseLostError);
    expect(await lossy.uploadPart('u', 1, new Uint8Array(), '')).toEqual({ etag: 'e3' });
  });

  it('dropConnectionAfter(n): n calls succeed, the next is processed but its response is lost, the rest never arrive', async () => {
    const { store, counts } = fakeStore();
    const client = new TestClient(store, { lostResponses: {} });
    client.dropConnectionAfter(2);
    await client.uploadPart('u', 1, new Uint8Array(), '');
    await client.uploadPart('u', 2, new Uint8Array(), '');
    await expect(client.uploadPart('u', 3, new Uint8Array(), '')).rejects.toBeInstanceOf(ResponseLostError);
    await expect(client.uploadPart('u', 4, new Uint8Array(), '')).rejects.toBeInstanceOf(ConnectionDroppedError);
    expect(counts().parts).toBe(3);
    client.reconnect();
    await client.uploadPart('u', 4, new Uint8Array(), '');
    expect(counts().parts).toBe(4);
  });

  it('retrying retries network errors only', async () => {
    let n = 0;
    expect(
      await retrying(async () => {
        if (++n < 3) throw new ResponseLostError('x');
        return 'ok';
      }),
    ).toBe('ok');
    await expect(
      retrying(async () => {
        throw new Error('app error');
      }),
    ).rejects.toThrow('app error');
  });
});
