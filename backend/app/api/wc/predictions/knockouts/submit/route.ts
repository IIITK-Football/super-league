
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new Response(null, { status: 200, headers: corsHeaders });
}

// Closed archive (D-02): the World Cup prediction deadline passed on 2026-06-22, and every submission has been refused
// since. The old write path trusted a body user_id and wrote with the secret key, so it is gone; only the refusal is
// served, with the same status and body.
export async function POST() {
  return Response.json({ success: false, error: 'Deadline passed. Predictions are locked.' }, { status: 403, headers: corsHeaders });
}