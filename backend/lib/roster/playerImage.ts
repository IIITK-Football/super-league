// Player portraits: validation and upload for the portrait route (captains and dictators).
// The R2 client is created only when an image is uploaded, so routes that do not upload work without R2 settings.
// Keys are the player's id (players/<id>.png); existing portraits and their URLs are never touched.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export class ImageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// A portrait is a 500 x 500 PNG of at most 5 MB (the size the FUT card expects).
export function validatePortrait(buffer: Buffer): void {
  if (buffer.length > MAX_IMAGE_SIZE) throw new ImageError('The image must be 5 MB or smaller.', 413);
  const isPng = buffer.length >= 24 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  if (!isPng) throw new ImageError('Player images must be in PNG format.', 400);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 500 || height !== 500) throw new ImageError(`Player images must be 500 x 500 pixels (received ${width}x${height}).`, 400);
}

function storage() {
  const bucket = process.env.R2_FRESHERS_BUCKET_NAME || process.env.R2_BUCKET_NAME;
  // Same public base as before this change; moving it into configuration belongs to the storage work.
  const publicBase = (process.env.NEXT_PUBLIC_FRESHERS_R2_URL || process.env.R2_PUBLIC_URL || 'https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev').replace(/\/+$/, '');
  if (!bucket || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new ImageError('Cloudflare image storage is not configured on the server.', 503);
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  return { client, bucket, publicBase };
}

export function portraitKey(playerId: string): string {
  return `players/${playerId}.png`;
}

export async function uploadPortrait(key: string, buffer: Buffer): Promise<string> {
  const { client, bucket, publicBase } = storage();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/png', CacheControl: 'public, max-age=3600' }));
  return `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function readPortrait(form: FormData): Promise<Buffer | null> {
  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) return null;
  const buffer = Buffer.from(await image.arrayBuffer());
  validatePortrait(buffer);
  return buffer;
}
