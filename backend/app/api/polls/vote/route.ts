import { NextResponse } from 'next/server';
import { publishableKey } from '@/lib/supabase/keys';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { handleError } from '../../../../lib/errorHandler';
import { z } from 'zod';

const voteSchema = z.object({
  optionId: z.string().uuid({ message: "Invalid option ID format." }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validatedData = voteSchema.parse(body);

    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.SUPABASE_URL!, publishableKey(), {
      cookies: { getAll() { return cookieStore.getAll() }, setAll() {} },
    });

    // Trigger our custom SQL function to safely increment the vote!
    const { error } = await supabase.rpc('increment_vote', {
      selected_option_id: validatedData.optionId
    });

    if (error) throw error;

    return NextResponse.json({ success: true, message: "Vote successfully recorded!" });

  } catch (error) {
    return handleError(error, "Submit Poll Vote");
  }
}