
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { handleError } from '../../../../lib/errorHandler';
import { r2, R2_BUCKET_NAME, R2_PUBLIC_URL } from '../../../../lib/r2';

export const runtime = 'nodejs';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

type ImageMimeType = keyof typeof IMAGE_TYPES;

async function getSupabaseClient(request: Request) {
  const cookieStore = await cookies();
  const authHeader = request.headers.get('Authorization');

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    }
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { success: false, message },
    { status }
  );
}

function isImageMimeType(type: string): type is ImageMimeType {
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, type);
}

function getImageKey(email: string, extension: string) {
  const localPart = email.split('@')[0];

  if (!localPart || !/^[a-z0-9._-]+$/i.test(localPart)) {
    throw new Error('Email cannot be used as an image filename.');
  }

  return `${localPart}.${extension}`;
}

function getPublicImageUrl(key: string) {
  const publicBaseUrl = (process.env.NEXT_PUBLIC_FRESHERS_R2_URL || process.env.R2_PUBLIC_URL || R2_PUBLIC_URL || '').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    throw new Error('R2 public URL is not configured.');
  }

  return `${publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// CREATE A PLAYER
export async function POST(request: Request) {
  let uploadedKey: string | null = null;

  try {
    if (!request.headers.get('Authorization')) {
      return jsonError('Authentication is required.', 401);
    }

    const formData = await request.formData();

    const email = String(formData.get('email') || '')
      .trim()
      .toLowerCase();

    const firstName = String(formData.get('first_name') || '').trim();
    const lastName = String(formData.get('last_name') || '').trim();
    const position = String(formData.get('position') || '').trim();

    const teamId = String(formData.get('team_id') || '').trim();
    const jerseyValue = String(formData.get('jersey_number') || '').trim();
    const ratingValue = String(formData.get('overall_rating') || '50').trim();
    const image = formData.get('image');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError('A valid player email is required.', 400);
    }

    if (!firstName || !lastName || !position) {
      return jsonError(
        'First name, last name, and position are required.',
        400
      );
    }

    if (!(image instanceof File) || image.size === 0) {
      return jsonError('A player image is required.', 400);
    }

    if (image.size > MAX_IMAGE_SIZE) {
      return jsonError('The image must be 5 MB or smaller.', 400);
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const isPng = buffer.length >= 24 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;

    if (!isPng) {
      return jsonError('Player image must be in PNG format.', 400);
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    if (width !== 512 || height !== 512) {
      return jsonError(`Player image must be 512x512 pixels (received ${width}x${height}).`, 400);
    }

    const jerseyNumber = jerseyValue ? Number(jerseyValue) : null;
    const overallRating = Number(ratingValue);

    if (
      jerseyNumber !== null &&
      (!Number.isInteger(jerseyNumber) ||
        jerseyNumber < 1 ||
        jerseyNumber > 99)
    ) {
      return jsonError('Jersey number must be between 1 and 99.', 400);
    }

    if (
      !Number.isInteger(overallRating) ||
      overallRating < 1 ||
      overallRating > 99
    ) {
      return jsonError('Overall rating must be between 1 and 99.', 400);
    }

    if (!R2_BUCKET_NAME || !R2_PUBLIC_URL) {
      throw new Error('R2 bucket name or public URL is missing.');
    }

    const supabase = await getSupabaseClient(request);

    // Validate the user's token before processing the write.
    const { data: authData, error: authError } =
      await supabase.auth.getUser();

    if (authError || !authData.user) {
      return jsonError('Invalid or expired authentication token.', 401);
    }

    const imageKey = getImageKey(email, 'png');
    const imageUrl = getPublicImageUrl(imageKey);

    // Reject duplicate emails before uploading.
    const { data: existingPlayer, error: lookupError } = await supabase
      .from('players')
      .select('id')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existingPlayer) {
      return jsonError('A player with this email already exists.', 409);
    }

    const targetBucket = process.env.R2_FRESHERS_BUCKET_NAME || R2_BUCKET_NAME;
    if (!targetBucket) throw new Error('R2 bucket name is missing.');

    // Upload to Cloudflare R2.
    await r2.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: imageKey,
        Body: buffer,
        ContentType: 'image/png',
      })
    );

    uploadedKey = imageKey;

    // Insert into the existing players table.
    const { data, error } = await supabase
      .from('players')
      .insert({
        first_name: firstName,
        last_name: lastName,
        name: `${firstName} ${lastName}`,
        email,
        team_id: teamId || null,
        position,
        jersey_number: jerseyNumber,
        overall_rating: overallRating,
        attributes: {},
        image_url: imageUrl,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Player created and image uploaded.',
      data,
    });
  } catch (error) {
    // Best-effort cleanup if the database insert fails after upload.
    if (uploadedKey) {
      try {
        await r2.send(
          new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: uploadedKey,
          })
        );
      } catch (cleanupError) {
        console.error('Could not clean up uploaded player image:', cleanupError);
      }
    }

    return handleError(error, 'Admin Create Player');
  }
}

// UPDATE A PLAYER
export async function PUT(request: Request) {
  try {
    if (!request.headers.get('Authorization')) {
      return jsonError('Authentication is required.', 401);
    }

    const body = await request.json();

    if (!body.id) {
      return jsonError('Player ID is required for updates.', 400);
    }

    const supabase = await getSupabaseClient(request);

    const { data: authData, error: authError } =
      await supabase.auth.getUser();

    if (authError || !authData.user) {
      return jsonError('Invalid or expired authentication token.', 401);
    }

    const updates: Record<string, unknown> = {};

    const allowedFields = [
      'first_name',
      'last_name',
      'name',
      'email',
      'team_id',
      'position',
      'jersey_number',
      'overall_rating',
      'attributes',
      'image_url',
    ];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates[field] = body[field];
      }
    }

    if (body.first_name !== undefined || body.last_name !== undefined) {
      const { data: current, error: readError } = await supabase
        .from('players')
        .select('first_name, last_name')
        .eq('id', body.id)
        .single();

      if (readError) throw readError;

      const firstName = String(
        body.first_name ?? current.first_name ?? ''
      ).trim();

      const lastName = String(
        body.last_name ?? current.last_name ?? ''
      ).trim();

      updates.first_name = firstName;
      updates.last_name = lastName;
      updates.name = `${firstName} ${lastName}`;
    }

    if (body.email !== undefined) {
      if (
        typeof body.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      ) {
        return jsonError('A valid player email is required.', 400);
      }

      updates.email = body.email.trim().toLowerCase();
    }

    const { data, error } = await supabase
      .from('players')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Player updated.',
      data,
    });
  } catch (error) {
    return handleError(error, 'Admin Update Player');
  }
}

// DELETE A PLAYER
export async function DELETE(request: Request) {
  try {
    if (!request.headers.get('Authorization')) {
      return jsonError('Authentication is required.', 401);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return jsonError('Player ID is required for deletion.', 400);
    }

    const supabase = await getSupabaseClient(request);

    const { data: authData, error: authError } =
      await supabase.auth.getUser();

    if (authError || !authData.user) {
      return jsonError('Invalid or expired authentication token.', 401);
    }

    // Read the image key before deleting the database record.
    const { data: player, error: readError } = await supabase
      .from('players')
      .select('image_url')
      .eq('id', id)
      .single();

    if (readError) throw readError;

    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Delete only images belonging to this configured public bucket.
    if (player?.image_url?.startsWith(`${R2_PUBLIC_URL}/`)) {
      const key = player.image_url.slice(R2_PUBLIC_URL.length + 1);

      try {
        await r2.send(
          new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: decodeURIComponent(key),
          })
        );
      } catch (cleanupError) {
        console.error('Player deleted, but image cleanup failed:', cleanupError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Player deleted successfully.',
    });
  } catch (error) {
    return handleError(error, 'Admin Delete Player');
  }
}
