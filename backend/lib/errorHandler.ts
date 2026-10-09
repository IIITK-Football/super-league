import { NextResponse } from 'next/server';

export function handleError(error: any, context: string) {
  // 1. VERCEL LOGGING: Log the raw, highly-detailed error to the server console.
  // Vercel automatically captures `console.error` and stores it in your deployment logs!
  console.error(`[SERVER ERROR] - ${context}:`, error);

  // 2. DATA SANITIZATION: Strip sensitive data for the client
  let safeMessage = error.message || "An unexpected internal server error occurred.";
  let statusCode = 500;

  // We can safely pass 400 (Bad Request) or 401 (Unauthorized) messages to the client
  if (error.name === 'ZodError' || error.status === 400) {
    statusCode = 400;
    safeMessage = "Bad Request: Invalid payload.";
  } else if (error.status === 401) {
    statusCode = 401;
    safeMessage = "Unauthorized.";
  }

  // 3. UNIFIED RESPONSE FORMAT: The client NEVER sees raw database details or tokens
  return NextResponse.json(
    { 
      success: false, 
      message: safeMessage 
    },
    { status: statusCode }
  );
}