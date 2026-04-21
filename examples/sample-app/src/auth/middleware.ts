import { getSession } from "./session.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function authenticate(authHeader: string | undefined): AuthContext {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }
  const token = authHeader.slice(7);
  const session = getSession(token);
  if (!session) {
    throw new UnauthorizedError("Session expired or invalid");
  }
  return { userId: session.userId, sessionId: session.id };
}

export function requireRole(ctx: AuthContext, allowedRoles: string[], userRole: string): void {
  if (!allowedRoles.includes(userRole)) {
    throw new UnauthorizedError(`Role '${userRole}' is not permitted to perform this action`);
  }
}
