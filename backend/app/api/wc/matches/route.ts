import { NextResponse } from 'next/server';

export async function GET() {
  // Grab the key from the secure environment variables
  const apiKey = process.env.API_FOOTBALL_KEY;
  
  // To get World Cup matches, you'll first need to find the specific league_id for the World Cup.
  // For this test, let's look at a date range when the 2026 World Cup kicks off.
  const fromDate = '2026-06-11'; 
  const toDate = '2026-06-15';
  
  // Construct the URL exactly as apifootball.com expects it
const url = `https://apiv3.apifootball.com/?action=get_events&from=${fromDate}&to=${toDate}&league_id=28&APIkey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // Return the JSON data to your frontend
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching match data:", error);
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 });
  }
}