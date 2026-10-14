/** The multipart upload API as the browser sees it. */
export interface UploadApi {
  createMultipartUpload(key: string): Promise<{ uploadId: string }>;
  /** `crc32c` is 8 hex characters (shared/checksum.ts `crc32cHex`). */
  uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array, crc32c: string): Promise<{ etag: string }>;
  /** Parts the server has, sorted by part number. */
  listParts(uploadId: string): Promise<{ partNumber: number; etag: string; size: number }[]>;
  completeMultipartUpload(uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ versionId: string }>;
}

/** The request or its response was lost on the network. The server may or may not have processed it. */
export class NetworkError extends Error {
  constructor(message = 'Network connection lost') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server rejected the request. Retrying the same request will not help. */
export class ServerError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}
