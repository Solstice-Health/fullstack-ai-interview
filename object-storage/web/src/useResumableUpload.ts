import type { UploadApi } from './uploadApi';

export type UploadState = 'idle' | 'uploading' | 'paused' | 'done' | 'error';

export interface ResumableUpload {
  /** Share of the file uploaded, from 0 to 1. */
  progress: number;
  /**
   * idle: no file yet. uploading: in progress. paused: stopped by `pause()`.
   * done: the object is complete. error: stopped; `resume()` tries again.
   */
  state: UploadState;
  /** Stops sending parts. */
  pause(): void;
  /** Continues a paused or failed upload where it left off. */
  resume(): void;
  /** Set when `state` is done. */
  versionId?: string;
  /** Set when `state` is error. */
  error?: string;
}

export interface ResumableUploadOptions {
  /** Default: 5 MiB. */
  partSize?: number;
  /** Parts in flight at once. Default: 3. */
  concurrency?: number;
  /** Object key. Default: the file name. */
  key?: string;
}

/**
 * Uploads `file` through `api` as a multipart upload, starting as soon as
 * `file` is not null. Connections drop; the upload must survive that.
 */
export function useResumableUpload(file: File | null, api: UploadApi, options: ResumableUploadOptions = {}): ResumableUpload {
  throw new Error('Not implemented');
}
