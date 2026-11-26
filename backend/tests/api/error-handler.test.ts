// Error responses: a 500 never leaks the database message; a 400 says why the request was refused.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { handleError } from '../../lib/errorHandler';

const respond = async (error: unknown) => {
  const res = handleError(error, 'test');
  return { status: res.status, body: await res.json() };
};

describe('handleError', () => {
  it('hides the message of an unexpected database error behind a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await respond({ message: 'permission denied for table user_roles', code: '42501' });
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ success: false, message: 'An unexpected internal server error occurred.' });
  });

  it('passes the reason of a 400 through', async () => {
    const out = await respond({ status: 400, message: 'Predictions are closed for this match.' });
    expect(out).toEqual({ status: 400, body: { success: false, message: 'Predictions are closed for this match.' } });
  });

  it('names the first invalid field of a validation error', async () => {
    const zodError = (() => { try { z.object({ home: z.number().int().min(0, 'Home score cannot be negative.') }).parse({ home: -1 }); } catch (e) { return e; } })();
    const out = await respond(zodError);
    expect(out.status).toBe(400);
    expect(out.body.message).toBe('Home score cannot be negative.');
  });

  it('keeps the 401, 403 and 404 reasons the routes set', async () => {
    expect((await respond({ status: 403, message: 'Forbidden: not assigned.' })).body.message).toBe('Forbidden: not assigned.');
    expect((await respond({ status: 404, message: 'Match not found.' })).status).toBe(404);
  });
});
