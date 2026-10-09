import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleError } from '../../../../lib/errorHandler';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
);

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ player_id: string }> }
) {
    try {
        const { player_id } = await params;

        const { data, error } = await supabase
            .from('players')
            .select(`
        id, first_name, last_name, position, jersey_number, image_url, assists, 
        overall_rating, attributes,
        teams ( id, name )
      `)
            .eq('id', player_id)
            .maybeSingle();

        if (error) throw error;

        let player;

        if (data) {
            const { count: goalCount } = await supabase
                .from('goals')
                .select('*', { count: 'exact', head: true })
                .eq('player_id', player_id);

            player = {
                id: data.id,
                name: `${data.first_name} ${data.last_name}`,
                first_name: data.first_name,
                last_name: data.last_name,
                position: data.position,
                jersey_number: data.jersey_number,
                image_url: data.image_url,
                assists: data.assists ?? 0,
                goals: goalCount ?? 0,
                overall_rating: data.overall_rating ?? 50,
                attributes: data.attributes || null,
                team: (data as any).teams?.name || null,
                team_id: (data as any).teams?.id || null,
            };
        } else {
            // Check team_members table for Freshers
            const { data: fresherData, error: fresherError } = await supabase
                .from('team_members')
                .select(`
                    id, first_name, last_name, name, position, jersey_number, image_url, 
                    overall_rating, attributes,
                    team_registrations ( team_id, team_name )
                `)
                .eq('id', player_id)
                .maybeSingle();

            if (fresherError) throw fresherError;
            if (!fresherData) {
                return NextResponse.json({ success: false, error: 'Player not found' }, { status: 404 });
            }

            const firstName = fresherData.first_name || (fresherData.name ? fresherData.name.split(' ')[0] : '');
            const lastName = fresherData.last_name || (fresherData.name ? fresherData.name.split(' ').slice(1).join(' ') : '');

            player = {
                id: fresherData.id,
                name: fresherData.name || `${firstName} ${lastName}`.trim(),
                first_name: firstName,
                last_name: lastName,
                position: fresherData.position,
                jersey_number: fresherData.jersey_number,
                image_url: fresherData.image_url,
                assists: 0,
                goals: 0,
                overall_rating: fresherData.overall_rating ?? 50,
                attributes: fresherData.attributes || null,
                team: (fresherData as any).team_registrations?.team_name || null,
                team_id: (fresherData as any).team_registrations?.team_id || null,
            };
        }

        return NextResponse.json({ success: true, data: player });
    } catch (error) {
        return handleError(error, 'Fetch Player');
    }
}
