// F014 (encodes AS-003, the mission's central write-safety claim): "No code
// path in lib/ai/tools/** transitively reaches `.insert(`, `.update(`,
// `.delete(`, `.upsert(`, or `.rpc(`."
//
// A flat text grep over lib/ai/tools/*.ts (what F014's spec originally
// sketched) is exactly the shape that let the mission's original B1 write-
// safety bug ship: it passes cleanly while a write call sits one import hop
// away in a shared helper. lib/ai/__tests__/no-service-role.test.ts (F023)
// already solved this same class of problem for the service-role guard —
// a real TypeScript AST walk over the transitive static-import graph,
// rather than a regex over raw text. This test reuses that exact walk
// machinery (adapted to a different entry-point set and a different
// forbidden-pattern list) instead of re-deriving a weaker version of it.
//
// Entry points are every file under lib/ai/tools/ (excluding __tests__)
// PLUS lib/ai/docs-agent.ts and app/api/ai/docs/route.ts — the tool
// modules are reached through those in production, and a write call
// hiding in a helper that only docs-agent.ts imports (not any tool file
// directly) would otherwise be invisible to a walk that only starts at
// lib/ai/tools/*.ts.
//
// Falsifiability (this file's own point, per the feature spec): a fixture
// three-hop import chain plants a `.insert(` call at the leaf and proves
// the walk finds it, then the fixture is torn down. This is the "prove the
// guard can fail" evidence F014's spec requires.

import { describe, expect, it } from "vitest";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";
import ts from "typescript";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const ENTRY_ROOTS = [
  join(REPO_ROOT, "lib", "ai", "tools"),
  join(REPO_ROOT, "lib", "ai", "docs-agent.ts"),
  join(REPO_ROOT, "app", "api", "ai", "docs", "route.ts"),
];

// The exact five Supabase mutation entry points AS-003 names, detected as
// REAL call expressions (`<receiver>.insert(`, `<receiver>.rpc(`, etc.) via
// an AST walk — not a text/regex scan. A regex scan over raw source text
// also matches these five names inside comments and string literals (e.g.
// lib/supabase/server.ts's own doc comments *describe* `.insert()`/
// `.update()` as the calls its preview-write guard blocks, and its
// `builderProp === "insert"` string comparison, neither of which is an
// actual call), which would make the guard fail on files that are
// correctly read-only. Matching only `ts.isCallExpression` nodes whose
// callee is a `ts.isPropertyAccessExpression` with one of these names
// avoids both false-positive classes while still catching any receiver
// shape (`supabase.from("docs").update(`, `client.rpc(`, a variable, a
// chained builder, etc.) — receiver identity is deliberately not checked,
// since AS-003 forbids these calls anywhere in this tree, not just on a
// client named `supabase`.
const FORBIDDEN_METHOD_NAMES = new Set(["insert", "update", "delete", "upsert", "rpc"]);

function findForbiddenCall(source: string, fileName: string): string | null {
  const scriptKind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind,
  );

  let found: string | null = null;

  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      FORBIDDEN_METHOD_NAMES.has(node.expression.name.text)
    ) {
      found = `.${node.expression.name.text}(`;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function listSourceFiles(pathEntry: string): string[] {
  if (existsSync(pathEntry) && statSync(pathEntry).isFile()) {
    return [pathEntry];
  }
  const out: string[] = [];
  const stack = [pathEntry];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries: Dirent[] = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(REPO_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // Bare package specifier (e.g. @anthropic-ai/sdk, zod, diff) — not
    // repo code, so it can never be the source of a repo-local write call
    // via this edge.
    return null;
  }

  const candidates = [
    base,
    ...CODE_EXTENSIONS.map((ext) => base + ext),
    ...CODE_EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function extractSpecifiers(source: string, fileName: string): string[] {
  const specifiers: string[] = [];
  const scriptKind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind,
  );

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (
        (isDynamicImport || isRequire) &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

type WalkResult = {
  violation: { file: string; matched: string } | null;
  chain: string[];
};

function walkForViolation(entry: string): WalkResult {
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [entry];
  visited.add(entry);

  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(file, "utf8");

    const matched = findForbiddenCall(source, file);
    if (matched) {
      const chain: string[] = [file];
      let cursor = file;
      while (parent.has(cursor)) {
        cursor = parent.get(cursor)!;
        chain.unshift(cursor);
      }
      return { violation: { file, matched }, chain };
    }

    for (const specifier of extractSpecifiers(source, file)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !visited.has(resolved)) {
        visited.add(resolved);
        parent.set(resolved, file);
        queue.push(resolved);
      }
    }
  }

  return { violation: null, chain: [] };
}

function relPath(p: string): string {
  return p.replace(REPO_ROOT, "");
}

describe("no-writes transitive import guard (AS-003)", () => {
  const entryFiles = ENTRY_ROOTS.flatMap((root) => listSourceFiles(root)).filter(
    (f) => !f.includes(`${"__tests__"}`),
  );

  it("finds at least one entry file under lib/ai/tools/ (sanity check that the walk isn't vacuously empty)", () => {
    expect(entryFiles.length).toBeGreaterThan(0);
  });

  it("test_AS_003_no_ai_tool_transitively_reaches_an_insert_update_delete_upsert_or_rpc_call", () => {
    const violations: string[] = [];

    for (const entry of entryFiles) {
      const result = walkForViolation(entry);
      if (result.violation) {
        const chain = result.chain.map(relPath).join(" → ");
        violations.push(
          `${relPath(entry)}: reaches "${result.violation.matched}" via chain: ${chain}`,
        );
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("AS-003 guard falsifiability self-test: the walk can actually fail", () => {
  // Reproduces the exact shape that would let a write call slip past a
  // flat grep of lib/ai/tools/*.ts: entry -> hop -> leaf, with the write
  // call planted at the leaf, two hops away from the entry file, and the
  // middle edge written as a multi-line import (the specific shape a
  // naive single-line-regex import scanner misses). The fixture is
  // created and torn down entirely inside this test.
  const FIXTURE_ROOT = join(REPO_ROOT, "lib", "ai", "tools", "__tests__", "tmp-f014-fixture");
  const entryPath = join(FIXTURE_ROOT, "entry.ts");
  const hopPath = join(FIXTURE_ROOT, "hop.ts");
  const leafPath = join(FIXTURE_ROOT, "leaf.ts");

  function plantFixture(): void {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    writeFileSync(entryPath, `import { a } from "./hop";\nexport { a };\n`, "utf8");
    writeFileSync(
      hopPath,
      ["import {", "  leak,", "} from \"./leaf\";", "", "export const a = leak;", ""].join("\n"),
      "utf8",
    );
    // The forbidden call, planted at the leaf, two hops from the entry.
    writeFileSync(
      leafPath,
      `export function leak() {\n  return supabaseClient.from("docs").update({ content: "x" });\n}\n`,
      "utf8",
    );
  }

  function removeFixture(): void {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  }

  it("test_AS_003_guard_detects_a_2_hop_chain_whose_middle_edge_is_a_multi_line_import", () => {
    plantFixture();
    try {
      const result = walkForViolation(entryPath);
      expect(result.violation).not.toBeNull();
      expect(result.violation?.matched).toBe(".update(");
      expect(result.chain).toEqual([entryPath, hopPath, leafPath]);
    } finally {
      removeFixture();
    }
  });

  it("the same fixture, once the write call is removed, comes back clean (red -> green evidence)", () => {
    plantFixture();
    try {
      // Remove the write call, keep the rest of the chain intact.
      writeFileSync(leafPath, `export function leak() {\n  return "no write here";\n}\n`, "utf8");
      const result = walkForViolation(entryPath);
      expect(result.violation).toBeNull();
    } finally {
      removeFixture();
    }
  });
});
