import { sha256 } from "../utils/hash.js";
import { isStrongPassword } from "../utils/validate.js";

const SALT = process.env.PASSWORD_SALT ?? "dev-salt-change-in-production";

export function hashPassword(plaintext: string): string {
  return sha256(`${SALT}:${plaintext}`);
}

export function verifyPassword(plaintext: string, hashed: string): boolean {
  return hashPassword(plaintext) === hashed;
}

export function validatePasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (!isStrongPassword(password)) {
    return { ok: false, reason: "Password must be at least 8 characters with one uppercase letter and one number" };
  }
  return { ok: true };
}
