export type StoreErrorCode =
  /** Bucket, key, version or upload does not exist (or the caller may not know it exists). */
  | 'NotFound'
  /** The caller may not do this. */
  | 'AccessDenied'
  /** E.g. creating a bucket whose name is taken. */
  | 'Conflict'
  /** Malformed input, e.g. an empty key or a part number out of range. */
  | 'InvalidArgument'
  /** A part named in a complete was never uploaded, or its etag does not match. */
  | 'InvalidPart'
  /** Bytes do not match the checksum the client sent. */
  | 'BadDigest'
  /** The version is under a retention lock. */
  | 'ObjectLocked';

/** Every error the store returns to clients is a StoreError. */
export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
