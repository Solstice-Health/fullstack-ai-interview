// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../shared/checksum';
import { FakeUploadServer } from '../../web/src/fakeServer';
import { FlakyNetwork } from '../../web/src/flakyNetwork';
import { useResumableUpload } from '../../web/src/useResumableUpload';
import { KiB, MiB, bytes } from '../helpers/setup';

afterEach(cleanup);

describe('uploader UI', () => {
  it.skip('#18 (stretch) Uploader UI: the uploader resumes after a dropped connection without restarting at 0%, and progress never goes backwards', async () => {
    const data = bytes(1 * MiB + 77, 18);
    const file = new File([data], 'launch-video.mp4', { type: 'video/mp4' });
    const server = new FakeUploadServer();
    const network = new FlakyNetwork(server, { latencyMs: 3, dropAfterRequests: [8, 14], outageMs: 40 });

    const samples: number[] = [];
    const { result } = renderHook(() => {
      const upload = useResumableUpload(file, network, { partSize: 64 * KiB, concurrency: 3 });
      samples.push(upload.progress);
      return upload;
    });

    const state = () => result.current.state;
    for (let attempt = 0; attempt < 20 && state() !== 'done'; attempt++) {
      await waitFor(() => expect(['done', 'error', 'paused']).toContain(state()), { timeout: 5000 });
      if (state() !== 'done') {
        await new Promise((r) => setTimeout(r, 60));
        act(() => result.current.resume());
      }
    }

    expect(state()).toBe('done');
    expect(network.drops, 'the connection dropped during the upload').toBeGreaterThanOrEqual(2);
    const stored = server.objects.get('launch-video.mp4');
    expect(stored, 'object on the server').toBeDefined();
    expect(sha256Hex(stored!)).toBe(sha256Hex(data));

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!, `progress went from ${samples[i - 1]} to ${samples[i]}`).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
    expect(samples.at(-1)).toBe(1);
    expect(server.bytesReceived, 'parts already on the server are not sent again').toBeLessThan(data.length * 1.5);
  });
});
