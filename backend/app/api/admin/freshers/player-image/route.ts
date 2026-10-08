import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const authHeader = request.headers.get('Authorization') || '';
    const authClient = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

    const { data: role } = await authClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (!['dictator', 'admin'].includes(role?.role)) return NextResponse.json({ error: 'Only dictators can upload player images.' }, { status: 403 });

    const formData = await request.formData();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const image = formData.get('image');
    if (!email.includes('@') || !(image instanceof File) || image.type !== 'image/png') {
      return NextResponse.json({ error: 'A college email and a PNG image are required.' }, { status: 400 });
    }
    if (image.size > 3 * 1024 * 1024) return NextResponse.json({ error: 'The formatted image must be under 3 MB.' }, { status: 413 });

    const emailId = email.split('@')[0].replace(/[^a-z0-9._-]/g, '-').replace(/^[.-]+|[.-]+$/g, '');
    if (!emailId) return NextResponse.json({ error: 'That email cannot be used as an image name.' }, { status: 400 });
    const key = `${emailId}.png`;
    const bucket = process.env.R2_FRESHERS_BUCKET_NAME;
    const publicBaseUrl = (process.env.NEXT_PUBLIC_FRESHERS_R2_URL || 'https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev').replace(/\/$/, '');
    if (!bucket || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      return NextResponse.json({ error: 'Freshers image storage is not configured on the server.' }, { status: 503 });
    }

    await r2.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(await image.arrayBuffer()),
      ContentType: 'image/png',
      CacheControl: 'public, max-age=3600',
    }));

    return NextResponse.json({ success: true, key, imageUrl: `${publicBaseUrl}/${encodeURIComponent(key)}` });
  } catch (error) {
    console.error('Freshers player image upload failed:', error);
    return NextResponse.json({ error: 'The player image could not be uploaded.' }, { status: 500 });
  }
}
