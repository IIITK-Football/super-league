import { requestClient } from '@/lib/supabase/clients';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '10') || 10);
    const category = searchParams.get('category'); // <--- 1. Get Category from URL

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const supabase = requestClient(request);

    // 2. Build the query dynamically
    let query = supabase.from('newsletter').select('*', { count: 'exact' });

    // 3. Filter by category ONLY if it's provided and not "Latest News" (assuming Latest News = All)
    if (category && category !== 'Latest News' && category !== 'All') {
      query = query.eq('category', category);
    }

    // 4. Execute the query
    const { data, count, error } = await query
      .order('date', { ascending: false }) 
      .range(from, to);

    if (error) throw error;

    const totalPages = count ? Math.ceil(count / limit) : 0;

    return Response.json({
      success: true,
      data: data,
      meta: {
        total_items: count,
        total_pages: totalPages,
        current_page: page,
        items_per_page: limit
      }
    });

  } catch (error) {
    console.error("News fetch error:", error);
    return Response.json(
      { success: false, message: "Failed to fetch news" },
      { status: 500 }
    );
  }
}