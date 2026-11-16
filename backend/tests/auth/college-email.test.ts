// Group: auth-identity. Trusted-side college email rule.
import { describe, expect, it } from 'vitest';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail } from '../../lib/auth/collegeEmail';

describe('isCollegeEmail', () => {
  it.each(['a@iiitkottayam.ac.in', 'First.Last2026@IIITKottayam.ac.in', ' padded@iiitkottayam.ac.in '])(
    'accepts %s', (e) => expect(isCollegeEmail(e)).toBe(true));

  it.each([
    'a@gmail.com', 'a@iiitkottayam.ac.in.evil.com', 'a@xiiitkottayam.ac.in', 'a@sub.iiitkottayam.ac.in',
    '@iiitkottayam.ac.in', 'iiitkottayam.ac.in', 'a b@iiitkottayam.ac.in', '', 'a@iiitkottayam.ac.in@evil.com',
  ])('rejects %s', (e) => expect(isCollegeEmail(e)).toBe(false));

  it('rejects non-strings', () => {
    expect(isCollegeEmail(undefined)).toBe(false);
    expect(isCollegeEmail(null)).toBe(false);
    expect(isCollegeEmail(42 as unknown as string)).toBe(false);
  });

  it('exposes a clear user-facing message', () => {
    expect(COLLEGE_EMAIL_MESSAGE).toContain('@iiitkottayam.ac.in');
  });
});
