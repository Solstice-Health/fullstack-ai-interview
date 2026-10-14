/**
 * In-browser fake of the upload server, so the uploader runs without a backend.
 */
import { crc32cHex, sha256Hex } from '../../shared/checksum';
import { ServerError, type UploadApi } from './uploadApi';

interface Upload {
  key: string;
  parts: Map<number, { bytes: Uint8Array; etag: string }>;
  versionId?: string;
}

export class FakeUploadServer implements UploadApi {
  /** Completed objects by key (latest version). */
  readonly objects = new Map<string, Uint8Array>();
  /** Total part bytes received, including parts sent more than once. */
  bytesReceived = 0;
  /** Number of uploadPart requests processed. */
  partRequests = 0;
  private readonly uploads = new Map<string, Upload>();
  private seq = 0;

  async createMultipartUpload(key: string): Promise<{ uploadId: string }> {
    const uploadId = `upload-${++this.seq}`;
    this.uploads.set(uploadId, { key, parts: new Map() });
    return { uploadId };
  }

  async uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }> {
    const upload = this.open(uploadId);
    this.partRequests += 1;
    this.bytesReceived += bytes.length;
    if (crc32cHex(bytes) !== crc32c) throw new ServerError('BadDigest');
    const etag = sha256Hex(bytes).slice(0, 32);
    upload.parts.set(partNumber, { bytes: new Uint8Array(bytes), etag });
    return { etag };
  }

  async listParts(uploadId: string): Promise<{ partNumber: number; etag: string; size: number }[]> {
    const upload = this.open(uploadId);
    return [...upload.parts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partNumber, p]) => ({ partNumber, etag: p.etag, size: p.bytes.length }));
  }

  async completeMultipartUpload(uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ versionId: string }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new ServerError('NotFound');
    if (upload.versionId) return { versionId: upload.versionId };
    const chunks: Uint8Array[] = [];
    for (const { partNumber, etag } of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
      const p = upload.parts.get(partNumber);
      if (!p || p.etag !== etag) throw new ServerError('InvalidPart');
      chunks.push(p.bytes);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    upload.versionId = `v-${++this.seq}`;
    this.objects.set(upload.key, out);
    return { versionId: upload.versionId };
  }

  private open(uploadId: string): Upload {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.versionId) throw new ServerError('NotFound');
    return upload;
  }
}
