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
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      return NextResponse.json({ error: 'Team logo storage is not configured on the server.' }, { status: 503 });
    }
    if (!publicLogoBaseUrl) {
      return NextResponse.json({ error: 'The public team logo URL is not configured on the server.' }, { status: 503 });
    }
    if (!supabaseUrl || !publishable || !secret) {
      return NextResponse.json({ error: 'Team setup is not configured on the server.' }, { status: 503 });
    }

    const r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    const authHeader = request.headers.get('Authorization') || '';
    const cookieStore = await cookies();
    const authClient = createServerClient(supabaseUrl, publishable, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} },
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, secret);
    const formData = await request.formData();
    // Branding is a captain's (or a dictator's) change to a team they captain in the current season. A captain with
    // several such teams names the registration; the team is always the registration's own team.
    const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (!['captain', 'dictator'].includes(String(roleRow?.role))) {
      return NextResponse.json({ error: 'Only the team\'s captain can change its branding.' }, { status: 403 });
    }
    const registrationId = String(formData.get('registration_id') || '').trim();
    let query = adminClient
      .from('team_registrations')
      .select('id, team_id, team_name, season:seasons!inner(slug, is_current, division:divisions!inner(slug)), teams!inner(id, name, logo_url, team_color)')
      .eq('captain_id', user.id)
      .eq('season.is_current', true);
    if (registrationId) query = query.eq('id', registrationId);
    const { data: registrations, error: registrationError } = await query;

    if (registrationError) throw registrationError;
    if (!registrations?.length) {
      return NextResponse.json({ error: 'You do not captain a team in the current season. Contact your dictator.' }, { status: 409 });
    }
    if (registrations.length > 1) {
      return NextResponse.json({ error: 'Choose which of your teams to brand.' }, { status: 400 });
    }
    const registration = registrations[0];

    const team = Array.isArray(registration.teams) ? registration.teams[0] : registration.teams;
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

      const rawName = team.name || 'team';
      const teamSlug = rawName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '') || registration.team_id;

      // Logos are stored per division (Freshers logos keep their existing "freshers/" folder).
      const season = (Array.isArray(registration.season) ? registration.season[0] : registration.season) as any;
      const divisionSlug = (Array.isArray(season?.division) ? season.division[0] : season?.division)?.slug as string | undefined;
      const folder = divisionSlug || 'freshers';

      uploadedKey = `${folder}/${teamSlug}.png`;
      await r2.send(new PutObjectCommand({
        Bucket: bucket,
        Key: uploadedKey,
        Body: buffer,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=3600',
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
