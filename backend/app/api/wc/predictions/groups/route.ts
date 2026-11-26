import { jobClient } from '@/lib/supabase/clients';

export const dynamic = 'force-dynamic';

// Closed archive (D-02): the World Cup prediction deadline passed on 2026-06-22, and every submission has been refused
// since. The old write path trusted a body user_id and wrote with the secret key, so it is gone; only the refusal is
// served, with the same status and body.
export async function POST() {
  return Response.json({ success: false, error: 'Deadline passed. Predictions are locked.' }, { status: 403 });
}

export async function GET(request: Request) {
  const supabase = jobClient();
  try {
    // Grab the user_id from the URL query
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return Response.json({ success: false, error: "Missing user_id parameter" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('wc_group_predictions')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    // Format to match API spec
    const formattedData = data.map(d => ({
      ...d,
      first_place_id: d.predicted_1st_place,
      second_place_id: d.predicted_2nd_place,
      third_place_id: d.predicted_3rd_place,
      fourth_place_id: d.predicted_4th_place
    }));

    return Response.json({ success: true, data: formattedData });
  } catch (error: any) {
    console.error("Group Prediction Fetch Error:", error);
    return Response.json({ success: false, error: error.message || "Failed to fetch predictions" }, { status: 500 });
  }
}