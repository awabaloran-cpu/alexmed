// Direct S3-compatible storage (MinIO locally, any real S3-compatible bucket in
// production), replacing the Manus Forge presign proxy. Uploads go straight to
// the bucket from the server; downloads are served via a short-lived signed URL
// through /api/files/[...key] (redirect), mirroring the old /manus-storage/* path.
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client() {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const region = process.env.STORAGE_REGION || "us-east-1";
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Storage config missing: set STORAGE_ENDPOINT, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY"
    );
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // required for MinIO / most non-AWS S3-compatible endpoints
  });
}

function getBucket() {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new Error("Storage config missing: set STORAGE_BUCKET");
  return bucket;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = appendHashSuffix(normalizeKey(relKey));

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    })
  );

  return { key, url: `/api/files/${key}` };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/api/files/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    {
      expiresIn: 300,
    }
  );
}

// Lets the browser PUT the raw file straight to the bucket, bypassing our
// server entirely for the large-bytes part — needed because Vercel Serverless
// Functions reject request bodies over ~4.5MB before our code ever runs, so a
// large PDF can never reach a route handler as multipart form data the way it
// could reach the old Express server. The key is decided up front (by the
// caller, e.g. the /api/pdf/upload-url route) rather than hashed post-hoc like
// storagePut() does, since the browser needs to know the exact key before it
// uploads.
export async function storageGetUploadUrl(
  relKey: string,
  contentType = "application/octet-stream"
): Promise<string> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 900 }
  );
}

// Deleting an object that's already gone is a no-op success on S3 and every
// S3-compatible backend this app targets (MinIO included) — no existence
// check is needed for idempotency, it's inherent to the operation. Errors
// here (network/credentials/etc — never "already deleted") are logged and
// re-thrown; callers (see lib/db-books.ts's deleteBook) treat storage
// cleanup as best-effort and never let it block or fail a DB deletion that
// already committed.
export async function deleteObject(relKey: string): Promise<void> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    console.error("[Storage] Failed to delete object", { key, error });
    throw error;
  }
}

// S3's bulk-delete API caps at 1000 keys per request.
const DELETE_BATCH_SIZE = 1000;

// Bulk delete, chunked at the limit above. Deduplicates keys (a book's PDF,
// page screenshots, and visual assets are collected from separate tables and
// could theoretically overlap) since S3-compatible backends generally allow
// only one entry per key per DeleteObjects request. Per-key failures
// reported inside a successful response (Errors[]) are logged but don't
// stop remaining batches — this is best-effort cleanup, not a transaction.
export async function deleteObjects(relKeys: string[]): Promise<void> {
  const keys = Array.from(new Set(relKeys.map(normalizeKey)));
  if (!keys.length) return;

  const client = getS3Client();
  const bucket = getBucket();

  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    try {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
        })
      );
      if (result.Errors?.length) {
        console.error("[Storage] Some objects failed to delete", {
          errors: result.Errors,
        });
      }
    } catch (error) {
      console.error("[Storage] Bulk delete request failed", {
        batchSize: batch.length,
        error,
      });
      throw error;
    }
  }
}
