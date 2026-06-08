import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use the service role key to bypass RLS for updating a user profile from the backend
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { user_id, wc_team_flair } = body;

    if (!user_id || !wc_team_flair) {
      return NextResponse.json(
        { error: 'Missing user_id or wc_team_flair' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ wc_team_flair })
      .eq('id', user_id)
      .select()
      .single();

    if (error) {
      console.error('Supabase error updating WC flair:', error);
      return NextResponse.json(
        { error: 'Failed to update World Cup flair' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, profile: data }, { status: 200 });
  } catch (error) {
    console.error('Server error in /api/wc/flair:', error);
    return NextResponse.json(
      { error: 'Failed to update World Cup flair' },
      { status: 500 }
    );
  }
}
