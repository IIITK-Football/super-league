// Group: auth-identity. College email and password rules shown to users.
import { describe, expect, it } from 'vitest';
import { COLLEGE_EMAIL_MESSAGE, isCollegeEmail, validateNewPassword } from '../authRules';

describe('isCollegeEmail', () => {
  it('accepts college addresses regardless of case and padding', () => {
    expect(isCollegeEmail('a@iiitkottayam.ac.in')).toBe(true);
    expect(isCollegeEmail(' First.Last@IIITKottayam.ac.in ')).toBe(true);
  });

  it('rejects other domains, look-alikes and sub-domains', () => {
    for (const e of ['a@gmail.com', 'a@iiitkottayam.ac.in.evil.com', 'a@xiiitkottayam.ac.in', 'a@mail.iiitkottayam.ac.in', '', null, undefined, 'a b@iiitkottayam.ac.in']) {
      expect(isCollegeEmail(e)).toBe(false);
    }
  });

  it('has a clear message naming the domain', () => {
    expect(COLLEGE_EMAIL_MESSAGE).toContain('@iiitkottayam.ac.in');
  });
});

describe('validateNewPassword', () => {
  it('requires a reasonable minimum length', () => {
    expect(validateNewPassword('short')).toMatch(/at least 8/);
    expect(validateNewPassword('')).toMatch(/at least 8/);
    expect(validateNewPassword('long-enough-1')).toBeNull();
  });

  it('rejects a password equal to the email', () => {
    expect(validateNewPassword('a@iiitkottayam.ac.in', 'a@iiitkottayam.ac.in')).toMatch(/email/i);
  });
});
