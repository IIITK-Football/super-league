export const COLLEGE_EMAIL_DOMAIN = 'iiitkottayam.ac.in';
export const COLLEGE_EMAIL_MESSAGE = `Use your college email address ending in @${COLLEGE_EMAIL_DOMAIN}.`;

const COLLEGE_EMAIL = /^[^@\s]+@iiitkottayam\.ac\.in$/i;

/** True only for an address exactly in the college domain (no sub-domains or look-alikes). */
export function isCollegeEmail(value: unknown): value is string {
  return typeof value === 'string' && COLLEGE_EMAIL.test(value.trim());
}
