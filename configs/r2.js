import "dotenv/config";
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const {
    CLOUDFLARE_R2_ACCOUNT_ID,
    CLOUDFLARE_R2_ACCESS_KEY_ID,
    CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_R2_BUCKET_NAME,
    CLOUDFLARE_R2_PUBLIC_URL,
} = process.env;

const BUCKET = CLOUDFLARE_R2_BUCKET_NAME;
const PUBLIC_URL = (CLOUDFLARE_R2_PUBLIC_URL || "").replace(/\/+$/, "");

export const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
});

const EXTENSION_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const parseDataUri = (dataUri) => {
    const match = /^data:(.+?);base64,(.+)$/.exec(dataUri || "");
    if (!match) return { contentType: "image/jpeg", buffer: Buffer.from(dataUri || "", "base64") };
    return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
};

// Uploads a base64 data-URI image under `keyPrefix/` (no leading/trailing
// slash) and returns the generated object key + its public URL.
export const uploadImageToR2 = async (dataUri, keyPrefix) => {
    const { contentType, buffer } = parseDataUri(dataUri);
    const ext = EXTENSION_BY_MIME[contentType] || "jpg";
    const key = `${keyPrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));

    return { key, url: `${PUBLIC_URL}/${key}` };
};

// Uploads a raw buffer (any file type) under `key` and returns { key, url }.
// Used for dataset-storage file uploads (multer memoryStorage → R2).
export const uploadBufferToR2 = async (buffer, contentType, key) => {
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || "application/octet-stream",
    }));
    return { key, url: `${PUBLIC_URL}/${key}` };
};

export const getPublicUrl = (key) => `${PUBLIC_URL}/${key}`;

// Recovers the object key from a public URL previously returned by uploadImageToR2.
export const extractKeyFromUrl = (url = "") => {
    if (!url || !PUBLIC_URL || !url.startsWith(PUBLIC_URL)) return null;
    const key = url.slice(PUBLIC_URL.length).replace(/^\/+/, "");
    return key || null;
};

export const deleteFromR2 = async (key) => {
    if (!key) return;
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

// Batch delete, chunked to the S3-API 1000-key-per-request limit.
export const deleteManyFromR2 = async (keys = []) => {
    const validKeys = keys.filter(Boolean);
    const chunkSize = 1000;
    for (let i = 0; i < validKeys.length; i += chunkSize) {
        const chunk = validKeys.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        await r2.send(new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: chunk.map((Key) => ({ Key })) },
        }));
    }
};

// Lists every object under a prefix, paginating via ContinuationToken.
export const listR2Objects = async (prefix) => {
    const objects = [];
    let continuationToken;
    do {
        const result = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        objects.push(...(result.Contents || []));
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
};

export default r2;
