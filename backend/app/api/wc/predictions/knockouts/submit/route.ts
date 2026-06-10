import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { user_id, advancing_third_place_groups, predictions } = body;

        // Basic validation
        if (!user_id || !predictions || !predictions.champion_id) {
            return NextResponse.json({ success: false, error: "Missing required prediction data." }, { status: 400 });
        }

        // Upsert into our new table
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
            }, { onConflict: 'user_id' }); // Ensures users only have 1 active bracket

        if (error) throw error;

        return NextResponse.json({ success: true, message: "Knockout predictions saved successfully!" });

    } catch (error: any) {
        console.error("Submit Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}