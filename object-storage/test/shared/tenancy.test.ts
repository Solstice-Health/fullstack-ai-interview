import { describe, expect, it } from 'vitest';
import {
  BUCKET,
  acmeAdmin,
  alice,
  bob,
  expectBytes,
  expectStoreError,
  globexAdmin,
  listAll,
  setup,
  text,
} from '../helpers/setup';

describe('tenancy', () => {
  it.skip("#10 Tenancy: tenant A can't read, list or delete tenant B's objects, even with a guessed key or versionId", async () => {
    const { client } = await setup();
    const GLOBEX = 'globex-assets';
    await client.createBucket(bob, GLOBEX);
    await expectStoreError(client.createBucket(bob, BUCKET), 'Conflict', 'AccessDenied');

    const acmeData = text('acme brochure');
    const globexData = text('globex brochure');
    const secret = text('globex launch plan');
    const vAcme = (await client.putObject(alice, BUCKET, 'brochure.pdf', acmeData)).versionId;
    const vGlobex = (await client.putObject(bob, GLOBEX, 'brochure.pdf', globexData)).versionId;
    const vSecret = (await client.putObject(bob, GLOBEX, 'plans/secret.pdf', secret)).versionId;

    // Globex users, admins included, can't touch Acme's bucket.
    for (const ctx of [bob, globexAdmin]) {
      await expectStoreError(client.getObject(ctx, BUCKET, 'brochure.pdf'), 'AccessDenied', 'NotFound');
      await expectStoreError(client.getObject(ctx, BUCKET, 'brochure.pdf', { versionId: vAcme }), 'AccessDenied', 'NotFound');
      await expectStoreError(client.listObjects(ctx, BUCKET, '', { limit: 1000 }), 'AccessDenied', 'NotFound');
      await expectStoreError(client.deleteObject(ctx, BUCKET, 'brochure.pdf'), 'AccessDenied', 'NotFound');
      await expectStoreError(client.deleteObject(ctx, BUCKET, 'brochure.pdf', { versionId: vAcme }), 'AccessDenied', 'NotFound');
      await expectStoreError(client.putObject(ctx, BUCKET, 'brochure.pdf', text('defaced')), 'AccessDenied', 'NotFound');
      await expectStoreError(client.createMultipartUpload(ctx, BUCKET, 'big.mov'), 'AccessDenied', 'NotFound');
    }

    // Acme can't reach Globex's versions through its own bucket, by guessed versionId or path-like keys.
    await expectStoreError(client.getObject(alice, BUCKET, 'brochure.pdf', { versionId: vGlobex }), 'NotFound', 'AccessDenied');
    await expectStoreError(client.getObject(alice, BUCKET, 'plans/secret.pdf', { versionId: vSecret }), 'NotFound', 'AccessDenied');
    await expectStoreError(client.getObject(alice, BUCKET, `../${GLOBEX}/plans/secret.pdf`), 'NotFound', 'AccessDenied');
    await client.deleteObject(alice, BUCKET, 'brochure.pdf', { versionId: vGlobex }).catch(() => undefined);
    await client.deleteObject(acmeAdmin, BUCKET, 'plans/secret.pdf', { versionId: vSecret }).catch(() => undefined);
    await client.putObject(alice, BUCKET, `../${GLOBEX}/plans/secret.pdf`, text('overwritten?'));

    // Globex's data is intact.
    expectBytes(await client.getObject(bob, GLOBEX, 'brochure.pdf'), globexData);
    expectBytes(await client.getObject(bob, GLOBEX, 'brochure.pdf', { versionId: vGlobex }), globexData);
    expectBytes(await client.getObject(globexAdmin, GLOBEX, 'plans/secret.pdf', { versionId: vSecret }), secret);
    expect(await listAll(client, bob, GLOBEX, '')).toEqual(['brochure.pdf', 'plans/secret.pdf']);

    // Acme's data is intact and visible to its own admin.
    expectBytes(await client.getObject(acmeAdmin, BUCKET, 'brochure.pdf'), acmeData);
    expect(await listAll(client, alice, BUCKET, '')).toEqual([`../${GLOBEX}/plans/secret.pdf`, 'brochure.pdf']);
  });
});
