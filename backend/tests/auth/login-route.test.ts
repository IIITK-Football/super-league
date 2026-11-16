// Group: auth-identity. The backend password login route enforces the college rule itself.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signInWithPassword = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { signInWithPassword } }) }));

import { POST } from '../../app/api/auth/login/route';

const call = (body: unknown) =>
  POST(new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  signInWithPassword.mockReset();
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon';
});

describe('POST /api/auth/login', () => {
  it('rejects a non-college email with 400 before contacting Supabase', async () => {
    const res = await call({ email: 'someone@gmail.com', password: 'long-enough-1' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('@iiitkottayam.ac.in');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a missing password and look-alike domains', async () => {
    expect((await call({ email: 'a@iiitkottayam.ac.in' })).status).toBe(400);
    expect((await call({ email: 'a@iiitkottayam.ac.in.evil.com', password: 'x' })).status).toBe(400);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in a college email with the trimmed address', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' }, session: {} }, error: null });
    const res = await call({ email: ' student@iiitkottayam.ac.in ', password: 'long-enough-1' });
    expect(res.status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'student@iiitkottayam.ac.in', password: 'long-enough-1' });
  });

  it('answers wrong credentials with a generic 401', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    const res = await call({ email: 'student@iiitkottayam.ac.in', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe('Invalid login credentials');
  });
});
