import { readFileSync } from "node:fs";
import { extname } from "node:path";

export interface Chunk {
  id: string;
  filePath: string;
  kind: "function" | "class" | "interface" | "module" | "section" | "method";
  name?: string;
  startLine: number;
  endLine: number;
  content: string;
}

export function parseFile(filePath: string): Chunk[] {
  const ext = extname(filePath).toLowerCase();
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    try {
      return parseTypeScript(filePath, content, ext === ".tsx" || ext === ".jsx");
    } catch {
      // Fall back to regex if the AST parser chokes (e.g. unsupported syntax)
      return parseByRegex(filePath, content.split("\n"), [
        { pattern: /^(export\s+)?(async\s+)?function\s+(\w+)/, kind: "function", nameGroup: 3 },
        { pattern: /^(export\s+)?(abstract\s+)?class\s+(\w+)/, kind: "class", nameGroup: 3 },
        { pattern: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/, kind: "function", nameGroup: 2 },
        { pattern: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?function/, kind: "function", nameGroup: 2 },
      ]);
    }
  }

  if (ext === ".py") return parsePython(filePath, content.split("\n"));
  if (ext === ".md") return parseMarkdownSections(filePath, content.split("\n"));

  return [{
    id: `${filePath}::module`,
    filePath,
    kind: "module",
    startLine: 1,
    endLine: content.split("\n").length,
    content,
  }];
}

// ── TypeScript / JavaScript AST parser ─────────────────────────────────────

type ASTNode = Record<string, unknown>;

function parseTypeScript(filePath: string, content: string, jsx: boolean): Chunk[] {
  // Dynamic import to keep tree-sitter optional at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parse } = require("@typescript-eslint/typescript-estree") as {
    parse: (code: string, opts: Record<string, unknown>) => ASTNode;
  };

  const ast = parse(content, {
    jsx,
    loc: true,
    range: false,
    tolerant: true,
    comment: false,
  });

  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  const seenIds = new Set<string>();

  function uniqueId(base: string): string {
    let id = base;
    let n = 2;
    while (seenIds.has(id)) id = `${base}__${n++}`;
    seenIds.add(id);
    return id;
  }

  function loc(node: ASTNode): { start: number; end: number } {
    const l = node.loc as { start: { line: number }; end: { line: number } };
    return { start: l.start.line, end: l.end.line };
  }

  function slice(start: number, end: number): string {
    return lines.slice(start - 1, end).join("\n");
  }

  function visitDeclaration(node: ASTNode, parentName?: string): void {
    const type = node.type as string;

    // Unwrap export wrappers
    if (type === "ExportNamedDeclaration" || type === "ExportDefaultDeclaration") {
      const decl = (node.declaration ?? node.expression) as ASTNode | undefined;
      if (decl) visitDeclaration(decl, parentName);
      return;
    }

    if (type === "FunctionDeclaration" || type === "TSDeclareFunction") {
      const name = ((node.id as ASTNode | null)?.name as string) ?? "anonymous";
      const { start, end } = loc(node);
      chunks.push({
        id: uniqueId(`${filePath}::${name}`),
        filePath,
        kind: "function",
        name,
        startLine: start,
        endLine: end,
        content: slice(start, end),
      });
      return;
    }

    if (type === "ClassDeclaration" || type === "ClassExpression") {
      const name = ((node.id as ASTNode | null)?.name as string) ?? "AnonymousClass";
      const { start, end } = loc(node);
      // Add the class itself as one chunk
      chunks.push({
        id: uniqueId(`${filePath}::${name}`),
        filePath,
        kind: "class",
        name,
        startLine: start,
        endLine: end,
        content: slice(start, end),
      });
      // Also extract each method as its own chunk for finer granularity
      const body = (node.body as ASTNode)?.body as ASTNode[] | undefined;
      if (body) {
        for (const member of body) {
          const mtype = member.type as string;
          if (mtype === "MethodDefinition" || mtype === "PropertyDefinition") {
            const key = member.key as ASTNode;
            const methodName = (key?.name as string) ?? (key?.value as string) ?? "unknown";
            const value = member.value as ASTNode | null;
            if (value && (value.type === "FunctionExpression" || value.type === "ArrowFunctionExpression")) {
              const { start: ms, end: me } = loc(member);
              chunks.push({
                id: uniqueId(`${filePath}::${name}.${methodName}`),
                filePath,
                kind: "method",
                name: `${name}.${methodName}`,
                startLine: ms,
                endLine: me,
                content: slice(ms, me),
              });
            }
          }
        }
      }
      return;
    }

    if (type === "TSInterfaceDeclaration") {
      const name = (node.id as ASTNode)?.name as string ?? "Interface";
      const { start, end } = loc(node);
      chunks.push({
        id: uniqueId(`${filePath}::${name}`),
        filePath,
        kind: "interface",
        name,
        startLine: start,
        endLine: end,
        content: slice(start, end),
      });
      return;
    }

    if (type === "VariableDeclaration") {
      const declarations = node.declarations as ASTNode[];
      for (const decl of declarations) {
        const init = decl.init as ASTNode | null;
        if (!init) continue;
        const initType = init.type as string;
        if (initType === "ArrowFunctionExpression" || initType === "FunctionExpression") {
          const name = ((decl.id as ASTNode)?.name as string) ?? "anonymous";
          const { start, end } = loc(node);
          chunks.push({
            id: uniqueId(`${filePath}::${name}`),
            filePath,
            kind: "function",
            name,
            startLine: start,
            endLine: end,
            content: slice(start, end),
          });
        }
      }
    }
  }

  const body = (ast.body as ASTNode[]) ?? [];
  for (const node of body) visitDeclaration(node);

  if (chunks.length === 0) {
    return [{
      id: `${filePath}::module`,
      filePath,
      kind: "module",
      startLine: 1,
      endLine: lines.length,
      content,
    }];
  }

  return chunks;
}

// ── Python (regex — accurate enough for def/class) ─────────────────────────

function parsePython(filePath: string, lines: string[]): Chunk[] {
  return parseByRegex(filePath, lines, [
    { pattern: /^(async\s+)?def\s+(\w+)/, kind: "function", nameGroup: 2 },
    { pattern: /^class\s+(\w+)/, kind: "class", nameGroup: 1 },
  ]);
}

// ── Markdown sections ───────────────────────────────────────────────────────

function parseMarkdownSections(filePath: string, lines: string[]): Chunk[] {
  const headings: { line: number; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,3}\s+(.+)/);
    if (m) headings.push({ line: i, name: m[1] });
  }
  if (headings.length === 0) {
    return [{
      id: `${filePath}::module`,
      filePath,
      kind: "module",
      startLine: 1,
      endLine: lines.length,
      content: lines.join("\n"),
    }];
  }
  return headings.map((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].line - 1 : lines.length - 1;
    return {
      id: `${filePath}::${h.name.replace(/\s+/g, "_")}`,
      filePath,
      kind: "section" as const,
      name: h.name,
      startLine: h.line + 1,
      endLine: end + 1,
      content: lines.slice(h.line, end + 1).join("\n"),
    };
  });
}

// ── Generic regex fallback ──────────────────────────────────────────────────

interface RegexRule {
  pattern: RegExp;
  kind: Chunk["kind"];
  nameGroup: number;
}

function parseByRegex(filePath: string, lines: string[], rules: RegexRule[]): Chunk[] {
  const starts: { line: number; kind: Chunk["kind"]; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) {
      const m = lines[i].match(rule.pattern);
      if (m) { starts.push({ line: i, kind: rule.kind, name: m[rule.nameGroup] ?? "anonymous" }); break; }
    }
  }
  if (starts.length === 0) {
    return [{
      id: `${filePath}::module`,
      filePath,
      kind: "module",
      startLine: 1,
      endLine: lines.length,
      content: lines.join("\n"),
    }];
  }
  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].line - 1 : lines.length - 1;
    return {
      id: `${filePath}::${s.name}`,
      filePath,
      kind: s.kind,
      name: s.name,
      startLine: s.line + 1,
      endLine: end + 1,
      content: lines.slice(s.line, end + 1).join("\n"),
    };
  });
}
