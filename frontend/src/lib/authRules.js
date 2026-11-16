export const COLLEGE_EMAIL_DOMAIN = 'iiitkottayam.ac.in';
export const COLLEGE_EMAIL_MESSAGE = `Use your college email address ending in @${COLLEGE_EMAIL_DOMAIN}.`;
export const MIN_PASSWORD_LENGTH = 8;

const COLLEGE_EMAIL = /^[^@\s]+@iiitkottayam\.ac\.in$/i;

// Frontend check for a clear message. The same rule is enforced by trusted Auth/database paths.
export function isCollegeEmail(value) {
  return typeof value === 'string' && COLLEGE_EMAIL.test(value.trim());
}

// Returns an error message, or null when the password is acceptable.
export function validateNewPassword(password, email = '') {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (email && password.toLowerCase() === String(email).trim().toLowerCase()) {
    return 'Your password cannot be the same as your email address.';
  }
  return null;
}
