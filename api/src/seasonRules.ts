// Versioned season rules. The public read answers the latest published version only; drafts, history, saving and
// publishing are the dictator's, with the caller's own client, so RLS applies and the audit actor is the person.
// Block validation lives in the database (rules_blocks_valid), the one place that decides what a block may be.
import { handleError } from '../../backend/lib/errorHandler';
import { scopeFromUrl } from '../../backend/lib/scope';
import { publicClient, requestClient } from '../../backend/lib/supabase/clients';

type RouteContext = { params: Promise<{ id: string; version?: string }> };
type Client = ReturnType<typeof requestClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_FIELDS = 'id, version, published_at';

async function publicRules(request: Request) {
  const supabase = publicClient();
  try {
    const scope = await scopeFromUrl(supabase, request, { section: 'rules' });
    const { data, error } = await supabase.rpc('season_rules', { p_season: scope.season.id });
    if (error) throw error;
    return Response.json({ success: true, data: { season: scope.season.name, rules: data ?? null } });
  } catch (error) {
    return handleError(error, 'season_rules');
  }
}

function dictatorRoute(
  name: string,
  run: (supabase: Client, season: string, request: Request, version?: string) => Promise<unknown>,
) {
  return async (request: Request, context: RouteContext) => {
    try {
      if (!request.headers.get('authorization')) throw { status: 401 };
      const supabase = requestClient(request);
      const [{ data: { user } }, { data: allowed, error: roleError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('is_dictator'),
      ]);
      if (!user) throw { status: 401 };
      if (roleError) throw roleError;
      if (!allowed) throw { status: 403, message: 'Only a dictator can manage rules.' };
      const { id, version } = await context.params;
      if (!UUID.test(id)) throw { status: 400 };
      return Response.json({ success: true, data: await run(supabase, id, request, version) });
    } catch (error) {
      return handleError(error, name);
    }
  };
}

const workspace = dictatorRoute('rules_workspace', async (supabase, season) => {
  const [draft, versions] = await Promise.all([
    supabase.from('season_rules_drafts').select('blocks, based_on_version, updated_at').eq('season_id', season).maybeSingle(),
    supabase.from('season_rules_versions').select(VERSION_FIELDS).eq('season_id', season).order('version', { ascending: false }),
  ]);
  if (draft.error) throw draft.error;
  if (versions.error) throw versions.error;
  return { draft: draft.data, versions: versions.data };
});

const saveDraft = dictatorRoute('save_rules_draft', async (supabase, season, request) => {
  const body = (await request.json().catch(() => null)) as { blocks?: unknown } | null;
  if (!Array.isArray(body?.blocks)) throw { status: 400 };
  const { error } = await supabase.rpc('save_rules_draft', { p_season: season, p_blocks: body.blocks });
  if (error) throw error;
  return null;
});

const publish = dictatorRoute('publish_rules', async (supabase, season) => {
  const { data, error } = await supabase.rpc('publish_rules', { p_season: season });
  if (error) throw error;
  return { version: data };
});

const oneVersion = dictatorRoute('rules_version', async (supabase, season, _request, version) => {
  if (!version || !/^[1-9]\d{0,8}$/.test(version)) throw { status: 400 };
  const { data, error } = await supabase.from('season_rules_versions').select(`${VERSION_FIELDS}, blocks`)
    .eq('season_id', season).eq('version', Number(version)).maybeSingle();
  if (error) throw error;
  if (!data) throw { status: 404, message: 'This version does not exist.' };
  return data;
});

export const rulesPublic = { GET: publicRules };
export const rulesWorkspace = { GET: workspace };
export const rulesDraft = { PUT: saveDraft };
export const rulesPublish = { POST: publish };
export const rulesVersion = { GET: oneVersion };
