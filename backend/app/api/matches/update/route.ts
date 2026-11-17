import { publishableKey } from '@/lib/supabase/keys';
  import { NextResponse } from 'next/server';
  import { createServerClient } from '@supabase/ssr';
  import { cookies } from 'next/headers';
  import { matchUpdateSchema } from '../../../../lib/validations'; // Import the schema!

  export async function POST(request: Request) {
    try {
      const cookieStore = await cookies();

      const supabase = createServerClient(
        process.env.SUPABASE_URL!,
        publishableKey(),
        {
          cookies: {
            getAll() { return cookieStore.getAll() },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
            },
          },
        }
      );

      // 1. Security Check
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json(
          { success: false, message: "Unauthorized: Invalid or missing session token" },
          { status: 401 }
        );
      }

      // 2. Parse the incoming JSON body
      const body = await request.json();

      // 3. ZOD VALIDATION: The Customs Inspector
      const validationResult = matchUpdateSchema.safeParse(body);

      if (!validationResult.success) {
        // If validation fails, immediately return a 400 Bad Request with the specific errors
        return NextResponse.json(
          { 
            success: false, 
            message: "Invalid request payload", 
            errors: validationResult.error.flatten().fieldErrors 
          },
          { status: 400 }
        );
      }

      // If it passes, we extract the perfectly typed data!
      const { matchId, home_score, away_score, status } = validationResult.data;

      // 4. Update the database
      const { data, error } = await supabase
        .from('matches')
        .update({ 
          home_score: home_score, 
          away_score: away_score, 
          status: status 
        })
        .eq('id', matchId)
        .select();

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: "Match updated successfully",
        data: data
      });

    } catch (error) {
      console.error("Update error:", error);
      return NextResponse.json(
        { success: false, message: "Failed to update match" },
        { status: 500 }
      );
    }
  }