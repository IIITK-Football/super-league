import { jobClient } from '@/lib/supabase/clients';

export const dynamic = 'force-dynamic';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: Request) {
  const supabase = jobClient();
    try {
        const { searchParams } = new URL(req.url);
        const user_id = searchParams.get('user_id');

        if (!user_id) return Response.json({ success: false, error: "User ID required" }, { status: 400, headers: corsHeaders });

        // 1. Fetch saved predictions
        const { data: savedBracket, error } = await supabase
            .from('wc_knockout_predictions')
            .select('*')
            .eq('user_id', user_id)
            .single();

        if (error || !savedBracket) {
            return Response.json({ success: true, data: null, message: "No knockout predictions found for this user." }, { status: 200, headers: corsHeaders });
        }

        // 2. We must regenerate the base R32 bracket so the UI knows how to draw the starting positions!
        // We do this by locally calling your own generator API or extracting that logic into a shared service.
        // For simplicity, we just fetch from your domain:
        const host = req.headers.get('host');
        const protocol = req.headers.get('x-forwarded-proto') || 'http';

        const generatorRes = await fetch(`${protocol}://${host}/api/wc/predictions/knockouts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: user_id,
                advancing_third_place_groups: savedBracket.advancing_third_place
            })
        });

        const generatedBase = await generatorRes.json();

        // 3. Return the fully packaged state
        return Response.json({
            success: true,
            data: {
                advancing_third_place_groups: savedBracket.advancing_third_place,
                initial_bracket: generatedBase.data,
                predictions: {
                    round_of_16: savedBracket.round_of_16,
                    quarter_finals: savedBracket.quarter_finals,
                    semi_finals: savedBracket.semi_finals,
                    final: savedBracket.final,
                    champion_id: savedBracket.champion_id
                }
            }
        }, { headers: corsHeaders });

    } catch (error: any) {
        return Response.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
    }
}