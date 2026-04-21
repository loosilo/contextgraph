import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, getGraphDistance, analyzeImpact } from "../graph.js";

const TMP = "/tmp/contextgraph-test-graph-ext";

beforeAll(() => {
  mkdirSync(join(TMP, ".contextgraph"), { recursive: true });
  mkdirSync(join(TMP, "src/utils"), { recursive: true });
  mkdirSync(join(TMP, "src/auth"), { recursive: true });
  mkdirSync(join(TMP, "src/orders"), { recursive: true });
  mkdirSync(join(TMP, "src/components"), { recursive: true });

  // Dependency chain: utils/hash ← auth/password ← auth/middleware ← orders/service
  writeFileSync(join(TMP, "src/utils/hash.ts"), `export function sha256(s: string) { return s; }\n`);
  writeFileSync(join(TMP, "src/auth/password.ts"), `import { sha256 } from "../utils/hash";\nexport function hashPw(p: string) { return sha256(p); }\n`);
  writeFileSync(join(TMP, "src/auth/middleware.ts"), `import { hashPw } from "./password";\nexport function auth() {}\n`);
  writeFileSync(join(TMP, "src/orders/service.ts"), `import { auth } from "../auth/middleware";\nexport function placeOrder() {}\n`);

  // Barrel export
  writeFileSync(join(TMP, "src/components/index.ts"), `export { Button } from "./Button";\nexport { Modal } from "./Modal";\n`);
  writeFileSync(join(TMP, "src/components/Button.ts"), `export const Button = () => {};\n`);
  writeFileSync(join(TMP, "src/components/Modal.ts"), `export const Modal = () => {};\n`);
  writeFileSync(join(TMP, "src/orders/ui.ts"), `import { Button } from "../components";\nexport const OrderForm = () => {};\n`);
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const files = () => [
  join(TMP, "src/utils/hash.ts"),
  join(TMP, "src/auth/password.ts"),
  join(TMP, "src/auth/middleware.ts"),
  join(TMP, "src/orders/service.ts"),
  join(TMP, "src/components/index.ts"),
  join(TMP, "src/components/Button.ts"),
  join(TMP, "src/components/Modal.ts"),
  join(TMP, "src/orders/ui.ts"),
];

describe("getGraphDistance", () => {
  beforeAll(() => buildGraph(TMP, files()));

  test("same file = distance 0", () => {
    const f = join(TMP, "src/utils/hash.ts");
    expect(getGraphDistance(f, f, TMP)).toBe(0);
  });

  test("direct import = distance 1", () => {
    expect(getGraphDistance(
      join(TMP, "src/auth/password.ts"),
      join(TMP, "src/utils/hash.ts"),
      TMP
    )).toBe(1);
  });

  test("two hops away = distance 2", () => {
    expect(getGraphDistance(
      join(TMP, "src/auth/middleware.ts"),
      join(TMP, "src/utils/hash.ts"),
      TMP
    )).toBe(2);
  });

  test("unreachable within maxHops returns maxHops+1", () => {
    const dist = getGraphDistance(
      join(TMP, "src/utils/hash.ts"),
      join(TMP, "src/components/Button.ts"),
      TMP, 1
    );
    expect(dist).toBeGreaterThan(1);
  });

  test("bidirectional: can find path in either direction", () => {
    // hash → password (forward: password imports hash)
    const forward = getGraphDistance(
      join(TMP, "src/utils/hash.ts"),
      join(TMP, "src/auth/password.ts"),
      TMP
    );
    expect(forward).toBe(1);
  });
});

describe("barrel export resolution", () => {
  beforeAll(() => buildGraph(TMP, files()));

  test("import through barrel adds transitive edges to barrel targets", () => {
    // orders/ui.ts imports from ../components (barrel)
    // The barrel re-exports Button and Modal
    // So orders/ui should have edges to Button and/or Modal
    const impacts = analyzeImpact(join(TMP, "src/components/Button.ts"), TMP);
    const affected = impacts.map((i) => i.file);
    // orders/ui.ts imports Button through the barrel
    expect(affected.some((f) => f.includes("ui.ts"))).toBe(true);
  });
});

describe("tsconfig path alias resolution", () => {
  test("builds graph without throwing on project with tsconfig", () => {
    // Create a minimal tsconfig with path aliases
    writeFileSync(join(TMP, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@utils/*": ["src/utils/*"] },
      },
    }));
    writeFileSync(join(TMP, "src/orders/aliased.ts"),
      `import { sha256 } from "@utils/hash";\nexport const x = sha256("test");\n`
    );
    expect(() => buildGraph(TMP, [...files(), join(TMP, "src/orders/aliased.ts")])).not.toThrow();
  });

  test("alias-based import creates graph edge", () => {
    const impacts = analyzeImpact(join(TMP, "src/utils/hash.ts"), TMP);
    const affected = impacts.map((i) => i.file);
    // aliased.ts uses @utils/hash — should appear in hash.ts's impact
    expect(affected.some((f) => f.includes("aliased.ts"))).toBe(true);
  });
});
