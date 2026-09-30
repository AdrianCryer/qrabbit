/**
 * The QRabbit Cloud sync protocol, as the app sees it.
 *
 * A collection in the cloud is a set of files, each the latest version of one path: a content hash, a size and the
 * collection revision it changed at. Deleting leaves a tombstone at a new revision, so other machines learn of it.
 * Content is stored once per user by SHA-256, so the same PDF in two collections costs one upload and one slot of
 * the quota. A client keeps the revision it last pulled and pushes with it as `base`; anything the cloud changed
 * after that on the same path comes back as a conflict for the client to merge, since only the client knows the
 * file formats.
 */

/** The cloud's default allowance per account: 5 GiB. Support can raise it per profile. */
export const DEFAULT_QUOTA_BYTES = 5 * 1024 ** 3;
/** How long a reserved or freshly unreferenced blob still counts towards the quota (mirrored in SQL). */
export const PENDING_WINDOW_HOURS = 1;
/** How long an unreferenced blob is kept before the garbage collector removes it (mirrored in the GC function). */
export const BLOB_GRACE_DAYS = 7;

export type Plan = "cloud" | "lapsed";

export type Me = {
  id: string;
  email: string | null;
  plan: Plan;
  quotaBytes: number;
  usedBytes: number;
  createdAt: string;
};

export type DevicePlatform = "win32" | "darwin" | "linux" | "other";

export type Device = {
  id: string;
  name: string;
  platform: DevicePlatform;
  createdAt: string;
  lastSeenAt: string;
};

export type CloudCollection = {
  /** The manifest's own id, so the same folder on two machines is one cloud collection. */
  id: string;
  name: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
};

/** The latest state of one path. A tombstone has `deleted` true, no hash and size 0. */
export type FileEntry = {
  path: string;
  sha256: string | null;
  size: number;
  deleted: boolean;
  rev: number;
  deviceId: string | null;
  updatedAt: string;
};

export type FileChange = { path: string; sha256: string } | { path: string; deleted: true };

export type CommitInput = {
  /** The revision the client last pulled through; the cloud judges conflicts against it. */
  base: number;
  changes: FileChange[];
  /** The registered device making the change, shown to other machines as who changed what. */
  deviceId?: string;
};

export type Conflict = { path: string; current: FileEntry };

export type CommitResult = {
  /** The collection's revision after the commit; unchanged when nothing was applied. */
  rev: number;
  applied: FileEntry[];
  /** Paths the cloud changed after `base`; the client merges and commits again with a newer base. */
  conflicts: Conflict[];
};

export type ChangesCursor = { rev: number; path: string };

export type ChangesPage = {
  /** The collection's revision when the page was read: the client's next `since` once every page is applied. */
  rev: number;
  entries: FileEntry[];
  /** Present when more entries follow; pass it back as `cursor`. */
  next: ChangesCursor | null;
};

export type BlobReservation = {
  sha256: string;
  /** `stored`: already in the cloud, skip the upload. `upload`: reserved, upload it. `quota`: it does not fit. */
  status: "stored" | "upload" | "quota";
};

export type ReserveResult = {
  items: BlobReservation[];
  usedBytes: number;
  quotaBytes: number;
};

export type CloudErrorCode =
  | "unauthenticated"
  | "bad_request"
  | "invalid_path"
  | "collection_not_found"
  | "blobs_missing"
  | "quota_exceeded"
  | "storage"
  | "network"
  | "unknown";

/** One error type for everything the client can throw, with a code the app can act on and the raw detail for logs. */
export class CloudError extends Error {
  readonly code: CloudErrorCode;
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(code: CloudErrorCode, message: string, opts: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "CloudError";
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
  }
}
