import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const user_id = searchParams.get('user_id');

        if (!user_id) return NextResponse.json({ success: false, error: "User ID required" }, { status: 400 });

        // 1. Fetch saved predictions
        const { data: savedBracket, error } = await supabase
            .from('wc_knockout_predictions')
            .select('*')
            .eq('user_id', user_id)
            .single();

        if (error || !savedBracket) {
            return NextResponse.json({ success: false, error: "No knockout predictions found." }, { status: 404 });
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
        return NextResponse.json({
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
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}