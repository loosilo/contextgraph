import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { parseFile } from "../parser.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-parser";

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function write(name: string, content: string) {
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

describe("TypeScript/JavaScript parsing", () => {
  test("extracts named functions", () => {
    const file = write("funcs.ts", `
function greet(name: string): string {
  return \`Hello \${name}\`;
}

async function fetchUser(id: number) {
  return { id };
}
`);
    const chunks = parseFile(file);
    const names = chunks.map((c) => c.name);
    expect(names).toContain("greet");
    expect(names).toContain("fetchUser");
  });

  test("extracts classes", () => {
    const file = write("cls.ts", `
export class UserService {
  constructor(private db: DB) {}
  getUser(id: string) { return this.db.find(id); }
}
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.kind === "class" && c.name === "UserService")).toBe(true);
  });

  test("extracts arrow function consts", () => {
    const file = write("arrow.ts", `
export const processItem = async (item: Item) => {
  return item.id;
};
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.name === "processItem")).toBe(true);
  });

  test("falls back to single module chunk when no top-level declarations", () => {
    const file = write("flat.ts", `const x = 1;\nconst y = 2;\n`);
    const chunks = parseFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("module");
  });

  test("chunk content contains source lines", () => {
    const file = write("content.ts", `
function add(a: number, b: number): number {
  return a + b;
}
`);
    const chunks = parseFile(file);
    const fn = chunks.find((c) => c.name === "add");
    expect(fn).toBeDefined();
    expect(fn!.content).toContain("return a + b");
  });

  test("chunk IDs are unique within a file", () => {
    const file = write("unique.ts", `
function alpha() {}
function beta() {}
function gamma() {}
`);
    const chunks = parseFile(file);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("start and end lines are positive integers", () => {
    const file = write("lines.ts", `
function hello() {
  console.log("hi");
}
`);
    const chunks = parseFile(file);
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThan(0);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    }
  });
});

describe("Python parsing", () => {
  test("extracts def functions", () => {
    const file = write("script.py", `
def compute(x, y):
    return x + y

async def fetch(url: str):
    pass
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.name === "compute")).toBe(true);
    expect(chunks.some((c) => c.name === "fetch")).toBe(true);
  });

  test("extracts classes", () => {
    const file = write("model.py", `
class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hi {self.name}"
`);
    const chunks = parseFile(file);
    expect(chunks.some((c) => c.kind === "class" && c.name === "User")).toBe(true);
  });
});

describe("Markdown parsing", () => {
  test("splits on headings", () => {
    const file = write("doc.md", `# Introduction\n\nSome text.\n\n## Setup\n\nInstall stuff.\n\n### Advanced\n\nMore stuff.\n`);
    const chunks = parseFile(file);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.name === "Introduction")).toBe(true);
    expect(chunks.some((c) => c.name === "Setup")).toBe(true);
  });

  test("falls back to single chunk for headingless markdown", () => {
    const file = write("plain.md", `Just some text\nwithout any headings.\n`);
    const chunks = parseFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("module");
  });
});

describe("Unknown file types", () => {
  test("returns single module chunk for unsupported extension", () => {
    const file = write("config.yaml", `name: myapp\nversion: 1.0\n`);
    const chunks = parseFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("module");
  });

  test("returns empty array for unreadable file", () => {
    const chunks = parseFile("/nonexistent/path/file.ts");
    expect(chunks).toEqual([]);
  });
});
