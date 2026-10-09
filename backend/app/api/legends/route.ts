import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../lib/errorHandler'; 

export const dynamic = 'force-dynamic'; 

export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    );

    const { data, error } = await supabase
      .from('top_scorers')
      .select('*')
      .order('goalsScored', { ascending: false })
      .limit(10); 

    // If Supabase throws an error, it gets caught immediately by the catch block
    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Legends fetched successfully",
      data: data
    });

  } catch (error) {
    // Pass the raw error and a context string to our new central utility!
    return handleError(error, "Legends API Fetch");
  }
}