import { keys, StorageError, storageFor, type Storage } from '@/lib/storage';
import { jobClient, requestClient } from '@/lib/supabase/clients';
import { myRoles } from '@/lib/auth/roles';
import { UUID } from '@/lib/roster/access';

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


export async function POST(request: Request) {
  let uploadedKey: string | null = null;

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !publishable || !secret) {
      return Response.json({ error: 'Team setup is not configured on the server.' }, { status: 503 });
    }
    // Storage is needed only when a logo is uploaded; a name or colour change works without it.
    let store: Storage | null = null;
    const logoStorage = () => {
      try {
        store ??= storageFor('logos');
        return store;
      } catch (error) {
        if (error instanceof StorageError) return null;
        throw error;
      }
    };
    const authClient = requestClient(request);
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'Please sign in again.' }, { status: 401 });
    }

    const formData = await request.formData();
    // Team details (name, short name, colour, logo) are the shared team's, changed by a dictator or by the captain of a
    // team entry whose assignment is writable (current or upcoming season, not completed or archived). The database
    // helper is_captain_of() decides, as the caller. A captain with several writable entries names the entry.
    const roles = await myRoles(authClient);
    const isDictator = roles.includes('dictator');
    if (!isDictator && !roles.includes('captain')) {
      return Response.json({ error: 'Only the team\'s captain can change its details.' }, { status: 403 });
    }
    const entryId = String(formData.get('team_entry_id') || '').trim();
    let candidateIds: string[];
    if (isDictator) {
      if (!UUID.test(entryId)) return Response.json({ error: 'Choose a team entry.' }, { status: 400 });
      candidateIds = [entryId];
    } else {
      const { data: mine, error: mineError } = await authClient.from('captain_assignments').select('team_entry_id').eq('user_id', user.id);
      if (mineError) throw mineError;
      candidateIds = (mine ?? []).map((a) => a.team_entry_id as string).filter((id) => !entryId || id === entryId);
    }
    const writable: string[] = [];
    for (const id of candidateIds) {
      const { data: ok, error: okError } = await authClient.rpc('is_captain_of', { p_entry: id });
      if (okError) throw okError;
      if (ok === true || isDictator) writable.push(id);
    }
    if (!writable.length) {
      return Response.json({ error: 'You do not captain a team in a current or upcoming season. Contact your dictator.' }, { status: 409 });
    }
    if (writable.length > 1) {
      return Response.json({ error: 'Choose which of your teams to change.' }, { status: 400 });
    }
    const adminClient = jobClient();
    const { data: entryRow, error: entryError } = await adminClient
      .from('team_entries')
      .select('id, team_id, season:seasons!inner(slug, division:divisions!inner(slug)), teams!inner(id, name, short_name, logo_url, team_color)')
      .eq('id', writable[0])
      .maybeSingle();
    if (entryError) throw entryError;
    if (!entryRow) return Response.json({ error: 'Team entry not found.' }, { status: 404 });
    const registration = entryRow as any;

    const team = Array.isArray(registration.teams) ? registration.teams[0] : registration.teams;
    // Name and short name are optional: an omitted field keeps the current value.
    const rawName = formData.get('team_name');
    const rawShort = formData.get('short_name');
    const newName = rawName === null ? team.name : String(rawName).trim();
    const newShort = rawShort === null ? team.short_name : String(rawShort).trim().toUpperCase();
    if (rawName !== null && (newName.length < 2 || newName.length > 60)) {
      return Response.json({ error: 'The team name must be 2 to 60 characters.' }, { status: 400 });
    }
    if (rawShort !== null && newShort && !/^[A-Z0-9]{2,5}$/.test(newShort)) {
      return Response.json({ error: 'The short name must be 2 to 5 letters or numbers.' }, { status: 400 });
    }
    const teamColor = String(formData.get('team_color') || '').trim();
    const logo = formData.get('logo');

    if (!/^#[0-9a-f]{6}$/i.test(teamColor)) {
      return Response.json({ error: 'Choose a valid team color.' }, { status: 400 });
    }
    if (logo !== null && !(logo instanceof File)) {
      return Response.json({ error: 'Choose a valid logo image.' }, { status: 400 });
    }
    if (!(logo instanceof File) && !team.logo_url) {
      return Response.json({ error: 'Upload a team logo before continuing.' }, { status: 400 });
    }

    let logoUrl = team.logo_url;
    if (logo instanceof File) {
      if (!logo.size || logo.size > MAX_LOGO_SIZE) {
        return Response.json({ error: 'Team logos must be no larger than 5 MB.' }, { status: 413 });
      }
      if (logo.type !== 'image/png') {
        return Response.json({ error: 'Club logo must be in PNG format.' }, { status: 400 });
      }

      const buffer = Buffer.from(await logo.arrayBuffer());
      if (!isPngBuffer(buffer)) {
        return Response.json({ error: 'The selected file is not a valid PNG image.' }, { status: 400 });
      }

      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width !== 256 || height !== 256) {
        return Response.json({
          error: `Club logo must be exactly 256x256 pixels (received ${width}x${height}). Do not crop, please upload a 256x256 PNG.`,
        }, { status: 400 });
      }

      const storage = logoStorage();
      if (!storage) return Response.json({ error: 'Team logo storage is not configured on the server.' }, { status: 503 });

      // One logo per team identity (shared by all its seasons), keyed by the team id; a version query string makes
      // a replaced logo show at once despite caching.
      uploadedKey = keys.teamLogo(registration.team_id);
      await storage.put(uploadedKey, buffer, 'image/png');
      logoUrl = `${storage.publicUrl(uploadedKey)}?v=${Date.now()}`;
    }

    const { error: updateError } = await adminClient
      .from('teams')
      .update({ name: newName, short_name: newShort || null, logo_url: logoUrl, team_color: teamColor })
      .eq('id', registration.team_id);

    if (updateError) {
      if (uploadedKey && store) {
        try {
          const s: Storage = store;
          await s.delete(uploadedKey);
        } catch (cleanupError) {
          console.error('Could not clean up an unreferenced team logo:', cleanupError);
        }
      }
      if ((updateError as { code?: string }).code === '23505') {
        return Response.json({ error: 'Another team already uses that name.' }, { status: 409 });
      }
      throw updateError;
    }

    return Response.json({ success: true, data: { name: newName, short_name: newShort || null, logo_url: logoUrl, team_color: teamColor } });
  } catch (error) {
    console.error('Captain team branding update failed:', error);
    return Response.json({ error: 'Could not save your team branding.' }, { status: 500 });
  }
}
