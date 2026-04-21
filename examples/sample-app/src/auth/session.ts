import { generateToken, sha256 } from "../utils/hash.js";

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

const SESSION_TTL_HOURS = 24;

// In production this is stored in Redis. Key: session:{token}
const store = new Map<string, Session>();

export function createSession(userId: string): Session {
  const token = generateToken(64);
  const session: Session = {
    id: sha256(token).slice(0, 16),
    userId,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000),
    createdAt: new Date(),
  };
  store.set(token, session);
  return session;
}

export function getSession(token: string): Session | null {
  const session = store.get(token);
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    store.delete(token);
    return null;
  }
  return session;
}

export function invalidateSession(token: string): void {
  store.delete(token);
}

export function invalidateAllSessions(userId: string): void {
  for (const [token, session] of store.entries()) {
    if (session.userId === userId) store.delete(token);
  }
}
