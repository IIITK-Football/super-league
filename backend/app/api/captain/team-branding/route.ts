import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_LOGO_SIZE = 5 * 1024 * 1024;

function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function getPublicLogoUrl(key: string, publicBaseUrl: string) {
  const publicUrl = publicBaseUrl.replace(/\/+$/, '');
  return `${publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function POST(request: Request) {
  let uploadedKey: string | null = null;

  try {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_LOGO_BUCKET || 'team-logos';
    const publicLogoBaseUrl =
      process.env.R2_LOGO_PUBLIC_URL ||
      'https://pub-faaac762b0254fb88c3967f021ced499.r2.dev';
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      return NextResponse.json({ error: 'Team logo storage is not configured on the server.' }, { status: 503 });
    }
    if (!publicLogoBaseUrl) {
      return NextResponse.json({ error: 'The public team logo URL is not configured on the server.' }, { status: 503 });
    }
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return NextResponse.json({ error: 'Team setup is not configured on the server.' }, { status: 503 });
    }

    const r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    const authHeader = request.headers.get('Authorization') || '';
    const cookieStore = await cookies();
    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: registration, error: registrationError } = await adminClient
      .from('team_registrations')
      .select('id, team_id, division, teams!inner(id, logo_url, team_color)')
      .eq('captain_id', user.id)
      .maybeSingle();

    if (registrationError) throw registrationError;
    if (!registration?.team_id) {
      return NextResponse.json({ error: 'Your team has not been assigned yet. Contact your dictator.' }, { status: 409 });
    }

    const team = Array.isArray(registration.teams) ? registration.teams[0] : registration.teams;
    const formData = await request.formData();
    const teamColor = String(formData.get('team_color') || '').trim();
    const logo = formData.get('logo');

    if (!/^#[0-9a-f]{6}$/i.test(teamColor)) {
      return NextResponse.json({ error: 'Choose a valid team color.' }, { status: 400 });
    }
    if (logo !== null && !(logo instanceof File)) {
      return NextResponse.json({ error: 'Choose a valid logo image.' }, { status: 400 });
    }
    if (!(logo instanceof File) && !team.logo_url) {
      return NextResponse.json({ error: 'Upload a team logo before continuing.' }, { status: 400 });
    }

    let logoUrl = team.logo_url;
    if (logo instanceof File) {
      if (!logo.size || logo.size > MAX_LOGO_SIZE) {
        return NextResponse.json({ error: 'Team logos must be no larger than 5 MB.' }, { status: 413 });
      }
      if (logo.type !== 'image/png') {
        return NextResponse.json({ error: 'Club logo must be in PNG format.' }, { status: 400 });
      }

      const buffer = Buffer.from(await logo.arrayBuffer());
      if (!isPngBuffer(buffer)) {
        return NextResponse.json({ error: 'The selected file is not a valid PNG image.' }, { status: 400 });
      }

      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width !== 256 || height !== 256) {
        return NextResponse.json({
          error: `Club logo must be exactly 256x256 pixels (received ${width}x${height}). Do not crop, please upload a 256x256 PNG.`,
        }, { status: 400 });
      }

      const divisionPrefix = registration.division && registration.division !== 'freshers'
        ? `${registration.division}/`
        : '';
      uploadedKey = `freshers/${divisionPrefix}${registration.team_id}/${crypto.randomUUID()}.png`;
      await r2.send(new PutObjectCommand({
        Bucket: bucket,
        Key: uploadedKey,
        Body: buffer,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      logoUrl = getPublicLogoUrl(uploadedKey, publicLogoBaseUrl);
    }

    const { error: updateError } = await adminClient
      .from('teams')
      .update({ logo_url: logoUrl, team_color: teamColor })
      .eq('id', registration.team_id);

    if (updateError) {
      if (uploadedKey) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: uploadedKey }));
        } catch (cleanupError) {
          console.error('Could not clean up an unreferenced team logo:', cleanupError);
        }
      }
      throw updateError;
    }

    return NextResponse.json({ success: true, data: { logo_url: logoUrl, team_color: teamColor } });
  } catch (error) {
    console.error('Captain team branding update failed:', error);
    return NextResponse.json({ error: 'Could not save your team branding.' }, { status: 500 });
  }
}
