/**
 * Shared new-password checks for self-service and desk-assist reset.
 * Length is enforced on the API. The set-password form also requires
 * uppercase, lowercase, a number, and a symbol before submit.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_TOO_SHORT_MESSAGE =
  "Password must be at least 8 characters";

export function passwordMeetsMinLength(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password === password.trim();
}

/** Client form: all strength rules, not only length. */
export function passwordMeetsStrengthRules(password: string): boolean {
  if (!passwordMeetsMinLength(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  if (!/[^\w\s]/.test(password)) return false;
  return true;
}

export const PASSWORD_STRENGTH_MESSAGE =
  "Use at least 8 characters with an uppercase letter, a lowercase letter, a number, and a symbol.";
