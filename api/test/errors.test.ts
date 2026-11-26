// Group: api-services. The shared error handler: database refusals are answers with their own status (a permission
// refusal is 403, a broken rule 400, a conflict 409), and an unexpected failure is a 500 with a fixed message, so the
// client never sees raw database or server details.
import { describe, expect, it, vi } from 'vitest';
import { handleError } from '../../backend/lib/errorHandler';

const answer = async (error: unknown) => {
  const res = handleError(error, 'test');
  return { status: res.status, message: (await res.json()).message };
};

describe('handleError', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('maps database refusals to client statuses', async () => {
    expect(await answer({ code: '42501', message: 'new row violates row-level security policy for table "matches"' }))
      .toEqual({ status: 403, message: 'You are not allowed to do that.' });
    expect(await answer({ code: '23505', message: 'duplicate key value violates unique constraint "teams_name_key"' }))
      .toEqual({ status: 409, message: 'That already exists.' });
    expect(await answer({ code: '22023', message: 'The awarded score must be two non-negative numbers' }))
      .toEqual({ status: 400, message: 'The awarded score must be two non-negative numbers' });
    expect(await answer({ code: 'P0002', message: 'Match not found' })).toEqual({ status: 404, message: 'Match not found' });
  });

  it('never shows the details of an unexpected failure', async () => {
    expect(await answer(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')))
      .toEqual({ status: 500, message: 'An unexpected internal server error occurred.' });
    expect(await answer({ code: 'XX000', message: 'internal error in relation "secret_table"' }))
      .toEqual({ status: 500, message: 'An unexpected internal server error occurred.' });
  });

  it('keeps the statuses routes throw themselves', async () => {
    expect((await answer({ status: 403, message: 'Not assigned to score this match.' })).status).toBe(403);
    expect((await answer({ status: 400, message: 'x' })).status).toBe(400);
    expect((await answer({ status: 401, message: 'x' })).status).toBe(401);
  });
});
