import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    const { data: teams, error } = await supabase
      .from('wc_teams')
      .select('id, name, logo_url, group_name')
      .not('group_name', 'is', null) // Ensures we only get teams assigned to groups
      .order('group_name', { ascending: true })
      .order('name', { ascending: true }); // Alphabetical within each group

    if (error) throw error;

    return NextResponse.json({ success: true, data: teams });
  } catch (error) {
    console.error("Fetch Teams Error:", error);
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 });
  }
}