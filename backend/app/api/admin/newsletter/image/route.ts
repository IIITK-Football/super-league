import { requestClient } from '@/lib/supabase/clients';
// News image upload through the API Worker (replaces the browser-direct presigned S3 upload). An editor or dictator
// posts the image as multipart form data (`image`); the Worker checks the type and size, stores it in the news bucket
// through the R2_NEWS binding under a server-generated key, and returns the public URL the article stores.
// The browser then loads the image straight from the bucket's public URL, never through the API.
import { hasAnyRole, myRoles } from '@/lib/auth/roles';
import { IMAGE_EXTENSIONS, keys, StorageError, storageFor } from '@/lib/storage';

export const MAX_NEWS_IMAGE_SIZE = 10 * 1024 * 1024;

// Each allowed type's file signature, so the declared type must match the bytes.
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

export async function POST(request: Request) {
  try {
    const supabase = requestClient(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!hasAnyRole(await myRoles(supabase), ['editor', 'dictator'])) {
      return Response.json({ success: false, error: 'Only an editor or a dictator can upload news images.' }, { status: 403 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ success: false, error: 'Send the image as form data.' }, { status: 400 });
    }
    const image = form.get('image');
    if (!(image instanceof File) || image.size === 0) {
      return Response.json({ success: false, error: 'Choose an image to upload.' }, { status: 400 });
    }
    if (image.size > MAX_NEWS_IMAGE_SIZE) {
      return Response.json({ success: false, error: 'News images must be 10 MB or smaller.' }, { status: 413 });
    }
    const contentType = image.type;
    if (!IMAGE_EXTENSIONS[contentType]) {
      return Response.json({ success: false, error: 'News images must be PNG, JPEG, WebP or GIF.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.length < 12 || !SIGNATURES[contentType](bytes)) {
      return Response.json({ success: false, error: 'The file is not a valid image of the type it claims.' }, { status: 400 });
    }

    let storage;
    try {
      storage = storageFor('news');
    } catch (error) {
      if (error instanceof StorageError) return Response.json({ success: false, error: 'News image storage is not configured on the server.' }, { status: 503 });
      throw error;
    }

    const key = keys.newsImage(crypto.randomUUID(), contentType);
    await storage.put(key, bytes, contentType);
    return Response.json({ success: true, publicUrl: storage.publicUrl(key) });
  } catch (error) {
    console.error('News image upload failed:', error);
    return Response.json({ success: false, error: 'Could not upload the image.' }, { status: 500 });
  }
}
