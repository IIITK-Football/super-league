// Player portraits: validation and upload for the portrait route (captains and dictators).
// The R2 client is created only when an image is uploaded, so routes that do not upload work without R2 settings.
// Keys are the player's id (players/<id>.png); existing portraits and their URLs are never touched.
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { keys, StorageError, storageFor } from '@/lib/storage';

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
  try {
    return storageFor('players');
  } catch (error) {
    if (error instanceof StorageError) throw new ImageError('Player image storage is not configured on the server.', 503);
    throw error;
  }
}

export function portraitKey(playerId: string): string {
  return keys.player(playerId);
}

export async function uploadPortrait(key: string, buffer: Buffer): Promise<string> {
  const store = storage();
  await store.client().send(new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: buffer, ContentType: 'image/png', CacheControl: 'public, max-age=3600' }));
  return store.publicUrl(key);
}

export async function readPortrait(form: FormData): Promise<Buffer | null> {
  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) return null;
  const buffer = Buffer.from(await image.arrayBuffer());
  validatePortrait(buffer);
  return buffer;
}
