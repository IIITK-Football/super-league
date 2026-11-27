import { ScopeError } from './scope';

// Postgres and PostgREST error codes that are answers, not failures: [status, fixed message or null to keep ours].
const DATABASE_STATUS: Record<string, [number, string | null]> = {
  '42501': [403, 'You are not allowed to do that.'], // insufficient privilege, including row level security
  '23505': [409, 'That already exists.'], // unique violation
  '23503': [409, 'That refers to something that does not exist or is still in use.'], // foreign key violation
  '22023': [400, null], // invalid parameter value (our functions' validation)
  '22007': [400, 'Enter a valid date.'],
  '22008': [400, 'Enter a valid date.'],
  '22P02': [400, 'Bad Request: Invalid value.'], // invalid text representation, e.g. a malformed id
  '23514': [400, null], // check violation (our functions' rules)
  P0002: [404, null], // no data found (our functions)
  PGRST116: [404, 'Not found.'], // .single() found no row
};

export function handleError(error: any, context: string) {
  // The raw error (database messages included) is logged for the operator and never sent to the client.
  console.error(`[SERVER ERROR] - ${context}:`, error);

  let safeMessage = "An unexpected internal server error occurred.";
  let statusCode = 500;

  if (error instanceof ScopeError) {
    // An unknown or malformed division/season: the message names only what the caller asked for.
    statusCode = error.status;
    safeMessage = error.message;
  } else if (error.name === 'ZodError') {
    statusCode = 400;
    safeMessage = error.issues?.[0]?.message ?? 'Bad Request: Invalid payload.';
  } else if (error.status === 400) {
    // Routes throw 400s with a reason the caller can act on ("Predictions are closed for this match.").
    statusCode = 400;
    safeMessage = error.message || 'Bad Request: Invalid payload.';
  } else if (error.status === 401) {
    statusCode = 401;
    safeMessage = "Unauthorized.";
  } else if (error.status === 403 || error.status === 404 || error.status === 409) {
    // Thrown by the routes themselves with a fixed message ("not assigned to score this match"), never a database error.
    statusCode = error.status;
    safeMessage = error.message || safeMessage;
  } else if (typeof error.code === 'string' && DATABASE_STATUS[error.code]) {
    // A database refusal is the caller's problem, not a server failure. Permission and conflict answers use fixed
    // messages; the checks our own functions raise (invalid value, rule broken, not found) carry readable messages.
    const [status, fixed] = DATABASE_STATUS[error.code];
    statusCode = status;
    safeMessage = fixed ?? error.message;
  } else {
    safeMessage = "An unexpected internal server error occurred.";
  }

  return Response.json(
    { success: false, message: safeMessage },
    { status: statusCode }
  );
}
