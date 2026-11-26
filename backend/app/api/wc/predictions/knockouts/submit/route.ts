import { jobClient } from '@/lib/supabase/clients';

export const dynamic = 'force-dynamic';

// Set the global deadline (Midnight IST entering June 21st)
const PREDICTION_DEADLINE = new Date('2026-06-22T00:00:00+05:30');

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: Request) {
  const supabase = jobClient();
    try {
        // 1. DEADLINE CHECK: Blocks any submissions after June 20th 11:59:59 PM IST
        if (new Date() > PREDICTION_DEADLINE) {
            return Response.json({ 
                success: false, 
                error: 'Deadline passed. Predictions are locked.' 
            }, { status: 403, headers: corsHeaders });
        }

        const body = await req.json();
        const { user_id, advancing_third_place_groups, predictions } = body;

        // Basic validation
        if (!user_id || !predictions || !predictions.champion_id) {
            return Response.json({ success: false, error: "Missing required prediction data." }, { status: 400, headers: corsHeaders });
        }

        // The frontend now sends the exact arrays of integer IDs (16, 8, 4, 2)
        // We can confidently save them directly into the database!
        const { error } = await supabase
            .from('wc_knockout_predictions')
            .upsert({
                user_id,
                advancing_third_place: advancing_third_place_groups,
                round_of_16: predictions.round_of_16,
                quarter_finals: predictions.quarter_finals,
                semi_finals: predictions.semi_finals,
                final: predictions.final,
                champion_id: predictions.champion_id,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' }); 

        if (error) throw error;

        return Response.json({ success: true, message: "Knockout predictions saved successfully!" }, { headers: corsHeaders });

    } catch (error: any) {
        console.error("Submit Error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders });
    }
}