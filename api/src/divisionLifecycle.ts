import { handleError } from '../../backend/lib/errorHandler';
import { requestClient } from '../../backend/lib/supabase/clients';

type Fields = Record<string, unknown>;
type RouteContext = { params: Promise<{ id: string }> };
type Payload = 'division' | 'season' | 'fields' | 'order' | 'seasonOrder' | 'sections' | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readFields(request: Request): Promise<Fields> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw { status: 400 };
  return body as Fields;
}

function getArgs(payload: Payload, body: Fields): Fields {
  switch (payload) {
    case 'division': return { p_fields: body };
    case 'season': {
      const { division_id, slug, name, starts_on = null, ends_on = null, format = 'league' } = body;
      if (typeof division_id !== 'string' || !UUID.test(division_id) || typeof slug !== 'string'
        || typeof name !== 'string' || typeof format !== 'string'
        || [starts_on, ends_on].some((value) => value !== null && (typeof value !== 'string' || !DATE.test(value)))) {
        throw { status: 400 };
      }
      return { p_division: division_id, p_slug: slug, p_name: name, p_starts_on: starts_on, p_ends_on: ends_on, p_format: format };
    }
    case 'fields':
      if (['starts_on', 'ends_on'].some((key) => key in body && body[key] !== null
        && (typeof body[key] !== 'string' || !DATE.test(body[key] as string)))) throw { status: 400 };
      return { p_fields: body };
    case 'order':
    case 'seasonOrder': {
      if (!Array.isArray(body.ids) || body.ids.some((value) => typeof value !== 'string' || !UUID.test(value))) {
        throw { status: 400 };
      }
      if (payload === 'order') return { p_ids: body.ids };
      if (typeof body.division_id !== 'string' || !UUID.test(body.division_id)) throw { status: 400 };
      return { p_ids: body.ids, p_division: body.division_id };
    }
    case 'sections': return { p_sections: body.sections ?? null };
    default: return {};
  }
}

function lifecycleRoute(
  operation: string,
  payload: Payload,
  idParam?: 'p_division' | 'p_season',
  status = 200,
) {
  return async (request: Request, context?: RouteContext) => {
    try {
      if (!request.headers.get('authorization')) throw { status: 401 };
      const supabase = requestClient(request);
      const [{ data: { user } }, { data: allowed, error: roleError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('is_dictator'),
      ]);
      if (!user) throw { status: 401 };
      if (roleError) throw roleError;
      if (!allowed) throw { status: 403, message: 'Only a dictator can configure divisions and seasons.' };

      const id = idParam ? (await context?.params)?.id : undefined;
      if (idParam && (!id || !UUID.test(id))) throw { status: 400 };
      const body = payload ? await readFields(request) : {};
      const args = getArgs(payload, body);
      if (idParam) args[idParam] = id;

      const { data, error } = operation === 'delete_division'
        ? await supabase.from('divisions').delete().eq('id', id).select('id').single()
        : await supabase.rpc(operation, args);
      if (operation === 'delete_division' && error?.code === '23503') {
        return Response.json({ success: false, message: 'This division has seasons. Archive it instead.' }, { status: 409 });
      }
      if (error) throw error;
      return Response.json({ success: true, data }, { status });
    } catch (error) {
      return handleError(error, operation);
    }
  };
}


export const divisionCreate = { POST: lifecycleRoute('create_division', 'division', undefined, 201) };
export const divisionDetail = {
  PATCH: lifecycleRoute('update_division', 'fields', 'p_division'),
  DELETE: lifecycleRoute('delete_division', null, 'p_division'),
};
export const divisionOrder = { PUT: lifecycleRoute('reorder_divisions', 'order') };
export const seasonCreate = { POST: lifecycleRoute('create_season', 'season', undefined, 201) };
export const seasonDetail = { PATCH: lifecycleRoute('update_season', 'fields', 'p_season') };
export const seasonOrder = { PUT: lifecycleRoute('reorder_seasons', 'seasonOrder') };
export const seasonCurrent = { POST: lifecycleRoute('set_current_season', null, 'p_season') };
export const seasonSections = { PUT: lifecycleRoute('save_season_sections', 'sections', 'p_season') };
