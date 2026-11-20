import { publishableKey } from '@/lib/supabase/keys';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  publishableKey()
);

export async function GET() {
  const { data, error } = await supabase.from('wc_player').select('*').limit(1);
  return Response.json({ data, error });
}
