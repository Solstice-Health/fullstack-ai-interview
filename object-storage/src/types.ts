/** Who is calling. Authentication has already happened. */
export interface Ctx {
  tenantId: string;
  userId: string;
  /** `admin` is an admin of their own tenant only. */
  role: 'member' | 'admin';
}

export interface ListResult {
  keys: string[];
  /** Present when there may be more keys. Pass it back as `cursor` to get the next page. */
  nextCursor?: string;
}

export interface PartInfo {
  partNumber: number;
  etag: string;
  size: number;
}
