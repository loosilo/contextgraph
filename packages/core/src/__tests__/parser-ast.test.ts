import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { parseFile } from "../parser.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-parser-ast";
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function write(name: string, content: string) {
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

describe("AST parser — TypeScript", () => {
  test("extracts exported async arrow function", () => {
    const file = write("arrow.ts", `
export const fetchUser = async (id: string): Promise<User> => {
  return db.find(id);
};
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.name === "fetchUser" && c.kind === "function")).toBe(true);
  });

  test("extracts class and its methods separately", () => {
    const file = write("service.ts", `
export class AuthService {
  constructor(private db: DB) {}

  async login(email: string, password: string) {
    const user = await this.db.findByEmail(email);
    return createSession(user.id);
  }

  logout(token: string) {
    invalidateSession(token);
  }
}
`);
    const chunks = parseFile(file);
    const names = chunks.map((c) => c.name);
    expect(names).toContain("AuthService");
    expect(names).toContain("AuthService.login");
    expect(names).toContain("AuthService.logout");
  });

  test("extracts TypeScript interface", () => {
    const file = write("types.ts", `
export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.kind === "interface" && c.name === "Session")).toBe(true);
  });

  test("extracts multiple functions from same file with unique IDs", () => {
    const file = write("utils.ts", `
export function add(a: number, b: number) { return a + b; }
export function subtract(a: number, b: number) { return a - b; }
export function multiply(a: number, b: number) { return a * b; }
`);
    const chunks = parseFile(file);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chunks.some((c) => c.name === "add")).toBe(true);
    expect(chunks.some((c) => c.name === "subtract")).toBe(true);
    expect(chunks.some((c) => c.name === "multiply")).toBe(true);
  });

  test("handles export default function", () => {
    const file = write("handler.ts", `
export default async function handler(req: Request) {
  return new Response("ok");
}
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.kind === "function" && c.name === "handler")).toBe(true);
  });

  test("handles nested const arrow inside export block", () => {
    const file = write("helpers.ts", `
export const processOrder = async (orderId: string) => {
  const order = await getOrder(orderId);
  return order;
};

export const cancelOrder = (orderId: string) => {
  return updateStatus(orderId, "cancelled");
};
`);
    const chunks = parseFile(file);
    const names = chunks.map((c) => c.name);
    expect(names).toContain("processOrder");
    expect(names).toContain("cancelOrder");
  });

  test("two functions with the same name get unique IDs", () => {
    // This can happen in poorly-structured files but should not crash
    const file = write("duplicate.ts", `
// Overloaded or duplicated names
function process(x: string): string;
function process(x: number): number;
function process(x: any): any { return x; }
`);
    const chunks = parseFile(file);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate IDs
  });

  test("falls back gracefully on syntax error", () => {
    const file = write("broken.ts", `
this is not valid typescript }{][
`);
    // Should not throw — returns module chunk or empty
    expect(() => parseFile(file)).not.toThrow();
  });

  test("chunk content spans correct lines", () => {
    const file = write("linecheck.ts", `
function first() {
  return 1;
}

function second() {
  return 2;
}
`);
    const chunks = parseFile(file);
    const first = chunks.find((c) => c.name === "first");
    const second = chunks.find((c) => c.name === "second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.content).toContain("return 1");
    expect(second!.content).toContain("return 2");
    expect(first!.content).not.toContain("return 2");
  });
});

describe("AST parser — TSX", () => {
  test("parses tsx file with JSX without throwing", () => {
    const file = write("component.tsx", `
import React from "react";

export const Button = ({ onClick, label }: { onClick: () => void; label: string }) => {
  return <button onClick={onClick}>{label}</button>;
};

export function Modal({ children }: { children: React.ReactNode }) {
  return <div className="modal">{children}</div>;
}
`);
    expect(() => parseFile(file)).not.toThrow();
    const chunks = parseFile(file);
    const names = chunks.map((c) => c.name);
    expect(names).toContain("Button");
    expect(names).toContain("Modal");
  });
});

describe("AST parser — graph import extraction via re-index", () => {
  test("barrel index.ts with re-exports is parseable", () => {
    const file = write("index.ts", `
export { authenticate, requireRole } from "./middleware";
export { createSession, getSession, invalidateSession } from "./session";
export type { AuthContext } from "./middleware";
`);
    const chunks = parseFile(file);
    // Barrel files with only exports may fall back to module chunk — that's fine
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("export");
  });
});
