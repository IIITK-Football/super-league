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
    let isAllowed = ['dictator', 'admin', 'captain'].includes(role?.role);
    if (!isAllowed) {
      const { data: reg } = await authClient.from('team_registrations').select('id').eq('captain_id', user.id).maybeSingle();
      if (reg) isAllowed = true;
    }
    if (!isAllowed) return NextResponse.json({ error: 'Only captains and dictators can upload player images.' }, { status: 403 });

    const formData = await request.formData();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const image = formData.get('image');
    if (!email.includes('@') || !(image instanceof File)) {
      return NextResponse.json({ error: 'A valid email and an image file are required.' }, { status: 400 });
    }
    if (image.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'The image must be under 5 MB.' }, { status: 413 });

    const buffer = Buffer.from(await image.arrayBuffer());

    // Validate PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const isPng = buffer.length >= 24 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;

    if (!isPng) {
      return NextResponse.json({ error: 'Player images uploaded by captains and dictators must be in PNG format.' }, { status: 400 });
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    if (width !== 500 || height !== 500) {
      return NextResponse.json({ error: `Player image must be 500*500 pixels (received ${width}x${height}).` }, { status: 400 });
    }

    const emailId = email.split('@')[0].replace(/[^a-z0-9._-]/g, '-').replace(/^[.-]+|[.-]+$/g, '');
    if (!emailId) return NextResponse.json({ error: 'That email cannot be used as an image name.' }, { status: 400 });
    
    const key = `${emailId}.png`;
    const bucket = process.env.R2_FRESHERS_BUCKET_NAME || process.env.R2_BUCKET_NAME;
    const publicBaseUrl = (process.env.NEXT_PUBLIC_FRESHERS_R2_URL || process.env.R2_PUBLIC_URL || 'https://pub-156b66d0ff7841bc9601620610a8ebd3.r2.dev').replace(/\/$/, '');
    if (!bucket || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      return NextResponse.json({ error: 'Cloudflare image storage is not configured on the server.' }, { status: 503 });
    }

    await r2.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=3600',
    }));

    return NextResponse.json({ success: true, key, imageUrl: `${publicBaseUrl}/${encodeURIComponent(key)}` });
  } catch (error) {
    console.error('Player image upload failed:', error);
    return NextResponse.json({ error: 'The player image could not be uploaded.' }, { status: 500 });
  }
}
