import { PutObjectCommand } from "@aws-sdk/client-s3";
import { publishableKey } from '@/lib/supabase/keys';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createServerClient } from '@supabase/ssr';
import { hasAnyRole, myRoles } from '@/lib/auth/roles';
import { noCookies } from '@/lib/http';
import { IMAGE_EXTENSIONS, keys, StorageError, storageFor } from '@/lib/storage';

export async function POST(req: Request) {
  try {
    const cookieStore = noCookies;
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasAnyRole(await myRoles(supabase), ['editor', 'dictator'])) return Response.json({ error: 'Insufficient role' }, { status: 403 });

    // The client's filename is accepted for compatibility but never used: the server generates the key.
    const { contentType } = await req.json();
    if (!contentType || !IMAGE_EXTENSIONS[contentType]) {
      return Response.json({ error: "News images must be PNG, JPEG, WebP or GIF." }, { status: 400 });
    }

    let storage;
    try {
      storage = storageFor('news');
    } catch (error) {
      if (error instanceof StorageError) return Response.json({ error: 'News image storage is not configured on the server.' }, { status: 503 });
      throw error;
    }

    const key = keys.newsImage(crypto.randomUUID(), contentType);
    const command = new PutObjectCommand({ Bucket: storage.bucket, Key: key, ContentType: contentType });

    // A signed upload URL valid for 60 seconds; the browser uploads the image straight to the bucket.
    const signedUrl = await getSignedUrl(storage.client(), command, { expiresIn: 60 });
    return Response.json({ success: true, signedUrl, publicUrl: storage.publicUrl(key) });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return Response.json({ success: false, error: "Failed to generate upload URL" }, { status: 500 });
  }
}