import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { handleError } from '../../../../lib/errorHandler';
import { UUID, dbErrorResponse, isResponse, jsonError, requireDictator } from '@/lib/roster/access';
import { ImageError, readPortrait, removePortrait, uploadPortrait } from '@/lib/roster/playerImage';

export const runtime = 'nodejs';

// Dictator player management. A player is a reusable identity (the FUT card: name, portrait, rating, attributes);
// a roster place (team entry, jersey, position) is managed through /api/admin/roster. Every query runs as the
// caller, so row level security enforces the dictator role on each write.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CardInput = { first_name?: unknown; last_name?: unknown; overall_rating?: unknown; attributes?: unknown; image_url?: unknown; email?: unknown };

// Validates the card fields that are present; returns the update or an error message.
function cardFields(body: CardInput, { creating }: { creating: boolean }): { card: Record<string, unknown>; email?: string | null } | string {
  const card: Record<string, unknown> = {};
  if (creating || body.first_name !== undefined) {
    const first = String(body.first_name ?? '').trim();
    if (!first || first.length > 100) return 'A first name of up to 100 characters is required.';
    card.first_name = first;
  }
  if (creating || body.last_name !== undefined) {
    const last = String(body.last_name ?? '').trim();
    if (last.length > 100) return 'The last name can have up to 100 characters.';
    card.last_name = last;
  }
  if (body.overall_rating !== undefined && body.overall_rating !== '') {
    const rating = Number(body.overall_rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 99) return 'Overall rating must be between 1 and 99.';
    card.overall_rating = rating;
  }
  if (body.attributes !== undefined) {
    let attributes = body.attributes;
    if (typeof attributes === 'string') {
      try {
        attributes = attributes.trim() ? JSON.parse(attributes) : {};
      } catch {
        return 'Attributes must be a JSON object.';
      }
    }
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return 'Attributes must be a JSON object.';
    card.attributes = attributes;
  }
  if (body.image_url !== undefined) {
    const url = body.image_url === null ? null : String(body.image_url).trim();
    if (url && !/^(https:\/\/|data:image\/)/.test(url)) return 'The portrait must be an https or data:image URL.';
    card.image_url = url || null;
  }
  let email: string | null | undefined;
  if (body.email !== undefined) {
    email = body.email === null ? null : String(body.email).trim().toLowerCase() || null;
    if (email && !EMAIL.test(email)) return 'Enter a valid email address, or leave it empty.';
  }
  return { card, email };
}

async function readBody(request: Request): Promise<{ fields: Record<string, unknown>; image: Buffer | null }> {
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await request.formData();
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
    return { fields, image: await readPortrait(form) };
  }
  return { fields: await request.json(), image: null };
}

// CREATE a player on a season roster: { team_entry_id, first_name, last_name, jersey_number?, position?,
// overall_rating?, attributes?, email? } as JSON, or multipart with an optional 500 x 500 PNG "image".
export async function POST(request: Request) {
  let uploadedKey: string | null = null;
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const { fields, image } = await readBody(request);

    const entry = String(fields.team_entry_id ?? '');
    if (!UUID.test(entry)) return jsonError('Choose the team and season to add the player to.', 400);
    const parsed = cardFields(fields, { creating: true });
    if (typeof parsed === 'string') return jsonError(parsed, 400);
    const jersey = fields.jersey_number === undefined || fields.jersey_number === '' || fields.jersey_number === null ? null : Number(fields.jersey_number);
    if (jersey !== null && (!Number.isInteger(jersey) || jersey < 0 || jersey > 99)) return jsonError('Jersey number must be between 0 and 99.', 400);
    const position = fields.position ? String(fields.position).trim() : null;
    if (position && position.length > 50) return jsonError('The position can have up to 50 characters.', 400);

    let imageUrl = (parsed.card.image_url as string | null | undefined) ?? null;
    if (image) {
      uploadedKey = `players/new-${randomUUID()}.png`;
      imageUrl = await uploadPortrait(uploadedKey, image);
    }

    const { data: playerId, error } = await caller.supabase.rpc('create_rostered_player', {
      p_team_entry_id: entry,
      p_first_name: parsed.card.first_name,
      p_last_name: parsed.card.last_name,
      p_jersey_number: jersey,
      p_position: position,
      p_overall_rating: (parsed.card.overall_rating as number | undefined) ?? 50,
      p_attributes: (parsed.card.attributes as object | undefined) ?? {},
      p_image_url: imageUrl,
      p_email: parsed.email ?? null,
    });
    const refused = dbErrorResponse(error);
    if (refused) {
      if (uploadedKey) await removePortrait(uploadedKey).catch(() => {});
      return refused;
    }
    if (error) throw error;
    uploadedKey = null;
    return NextResponse.json({ success: true, message: 'Player created and added to the roster.', data: { id: playerId } }, { status: 201 });
  } catch (error) {
    if (uploadedKey) await removePortrait(uploadedKey).catch(() => {});
    if (error instanceof ImageError) return jsonError(error.message, error.status);
    return handleError(error, 'Admin Create Player');
  }
}

// UPDATE a player's card and private email: { id, first_name?, last_name?, overall_rating?, attributes?, image_url?,
// email? } as JSON, or multipart with a new "image". Roster places change through /api/admin/roster.
export async function PUT(request: Request) {
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const { fields, image } = await readBody(request);
    const id = String(fields.id ?? '');
    if (!UUID.test(id)) return jsonError('Choose a player to update.', 400);
    const parsed = cardFields(fields, { creating: false });
    if (typeof parsed === 'string') return jsonError(parsed, 400);
    if (image) parsed.card.image_url = await uploadPortrait(`players/${id}.png`, image);

    if (Object.keys(parsed.card).length) {
      const { data, error } = await caller.supabase.from('players').update(parsed.card).eq('id', id).select('id');
      const refused = dbErrorResponse(error);
      if (refused) return refused;
      if (error) throw error;
      if (!data?.length) return jsonError('Player not found.', 404);
    }
    if (parsed.email !== undefined) {
      const { error } = parsed.email
        ? await caller.supabase.from('player_private_details').upsert({ player_id: id, email: parsed.email }, { onConflict: 'player_id' })
        : await caller.supabase.from('player_private_details').delete().eq('player_id', id);
      const refused = dbErrorResponse(error);
      if (refused) return refused;
      if (error) throw error;
    }
    return NextResponse.json({ success: true, message: 'Player updated.' });
  } catch (error) {
    if (error instanceof ImageError) return jsonError(error.message, error.status);
    return handleError(error, 'Admin Update Player');
  }
}

// DELETE a player identity (?id=). Only a player with no roster place and no match history can be deleted; anyone
// who has played is kept, because their goals, assists and seasons are history.
export async function DELETE(request: Request) {
  try {
    const caller = await requireDictator(request);
    if (isResponse(caller)) return caller;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!UUID.test(id)) return jsonError('Choose a player to delete.', 400);

    const [places, scored, assisted, lines] = await Promise.all([
      caller.supabase.from('roster_memberships').select('id', { count: 'exact', head: true }).eq('player_id', id),
      caller.supabase.from('goals').select('id', { count: 'exact', head: true }).eq('player_id', id),
      caller.supabase.from('goals').select('id', { count: 'exact', head: true }).eq('assist_id', id),
      caller.supabase.from('season_player_stats').select('season_id', { count: 'exact', head: true }).eq('player_id', id),
    ]);
    for (const r of [places, scored, assisted, lines]) if (r.error) throw r.error;
    if ((places.count ?? 0) > 0) return jsonError('Remove this player from every roster first. Players who have played cannot be deleted.', 409);
    if ((scored.count ?? 0) + (assisted.count ?? 0) + (lines.count ?? 0) > 0) {
      return jsonError('This player has match history (goals or assists), so the player is kept.', 409);
    }

    const { data, error } = await caller.supabase.from('players').delete().eq('id', id).select('id');
    const refused = dbErrorResponse(error);
    if (refused) return refused;
    if (error) throw error;
    if (!data?.length) return jsonError('Player not found.', 404);
    return NextResponse.json({ success: true, message: 'Player deleted.' });
  } catch (error) {
    return handleError(error, 'Admin Delete Player');
  }
}
