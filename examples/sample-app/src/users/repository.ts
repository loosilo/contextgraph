import { isEmail, isUUID } from "../utils/validate.js";
import { hashPassword } from "../auth/password.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "customer";
  createdAt: Date;
  deletedAt?: Date;
}

// Soft-delete aware in-memory store. Use findActive() unless you specifically need deleted users.
const users = new Map<string, User>();

export function findById(id: string): User | null {
  if (!isUUID(id)) return null;
  return users.get(id) ?? null;
}

export function findActive(id: string): User | null {
  const user = findById(id);
  return user?.deletedAt ? null : user ?? null;
}

export function findByEmail(email: string): User | null {
  if (!isEmail(email)) return null;
  for (const user of users.values()) {
    if (user.email === email && !user.deletedAt) return user;
  }
  return null;
}

export function createUser(email: string, password: string, role: User["role"] = "customer"): User {
  const user: User = {
    id: crypto.randomUUID(),
    email,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date(),
  };
  users.set(user.id, user);
  return user;
}

export function softDeleteUser(id: string): boolean {
  const user = findActive(id);
  if (!user) return false;
  user.deletedAt = new Date();
  return true;
}
