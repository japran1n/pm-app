// F023 (fixes B1 / AS-001): "No code path in lib/ai/** imports or
// references SUPABASE_SECRET_KEY or a service-role client." A flat text
// grep over lib/ai/tools/ (F014's currently-planned check) passes cleanly
// even when a service-role import is reachable one hop away through a
// helper module (exactly what happened here: docs-agent.ts imported
// lib/queries/people.ts, which imported lib/supabase/admin.ts). This test
// instead walks the transitive static-import graph starting from every
// file under lib/ai/** and app/api/ai/**, following both entry files and
// everything they import (recursively, via node_modules-external repo
// files only), and fails on any reachable module whose *source text*
// references SUPABASE_SECRET_KEY, createAdminClient, or service_role.
//
// Checking source text of each reachable file (rather than trying to
// resolve exactly which export in a barrel file is used) is a deliberate
// over-approximation: it can never miss a real reachable reference, which
// is the property that matters for a guard rail. It also cannot produce a
// false negative from re-export indirection (`export * from`), unlike a
// naive "does this file import X directly" check.

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
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";
import ts from "typescript";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ENTRY_GLOBS_ROOTS = [
  join(REPO_ROOT, "lib", "ai"),
  join(REPO_ROOT, "app", "api", "ai"),
];

const FORBIDDEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "SUPABASE_SECRET_KEY", pattern: /SUPABASE_SECRET_KEY/ },
  { name: "createAdminClient", pattern: /createAdminClient/ },
  { name: "service_role", pattern: /service_role/ },
];

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Recursively lists every source file under `dir` (skips node_modules). */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries: Dirent[] = readdirSync(current, {
      withFileTypes: true,
    });
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

/** Resolves a static import/export specifier to an absolute file path, or
 * null if it points into node_modules / a bare package (those can't
 * reach a repo-local admin client file by definition — service-role
 * reachability only matters for repo code). */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(REPO_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // Bare package specifier (react, next, @anthropic-ai/sdk, etc.) — not
    // repo code, not reachable to a repo-local admin client via this edge.
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

/** Extracts every static/dynamic import or export-from specifier from a
 * source file by walking the real TypeScript AST (not a regex). This
 * correctly sees, among other forms a regex over raw text tends to miss:
 *   - multi-line named/type imports (`import {\n  a,\n} from "x"`)
 *   - `import type { T } from "x"`
 *   - dynamic `import("x")` (including `await import(...)`)
 *   - `export * from "x"` and `export * as ns from "x"`
 *   - `export { a, b } from "x"` (single- or multi-line)
 *   - `require("x")`
 * regardless of how the statement is wrapped across lines. */
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

/** BFS over the transitive import graph starting at `entry`. Returns the
 * first forbidden-pattern hit found, plus the chain of files (entry ->
 * ... -> offending file) that reached it. */
function walkForViolation(entry: string): WalkResult {
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [entry];
  visited.add(entry);

  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(file, "utf8");

    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(source)) {
        const chain: string[] = [file];
        let cursor = file;
        while (parent.has(cursor)) {
          cursor = parent.get(cursor)!;
          chain.unshift(cursor);
        }
        return { violation: { file, matched: name }, chain };
      }
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

describe("no-service-role transitive import guard (AS-001, fixes B1)", () => {
  const entryFiles = ENTRY_GLOBS_ROOTS.flatMap((root) => listSourceFiles(root)).filter(
    (f) => !f.includes(`${sep}__tests__${sep}`),
  );

  it("finds at least one entry file under lib/ai/** and app/api/ai/** (sanity check that the walk isn't vacuously empty)", () => {
    expect(entryFiles.length).toBeGreaterThan(0);
  });

  it("test_AS_001_no_file_under_lib_ai_or_app_api_ai_transitively_reaches_a_service_role_reference", () => {
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

describe("AS-001 guard falsifiability self-test (F030): multi-line imports are not blind spots", () => {
  // F030: the original AS-001 guard's specifier regex excluded newlines
  // from its character class, so any import written across multiple
  // lines was invisible to the graph walk -- 430 repo-local multi-line
  // imports across 298 files, i.e. the house style. This planted fixture
  // reproduces the shape of the original B1 chain (entry -> helper ->
  // helper -> admin-like module) with the *middle* edge written as a
  // multi-line import, proving the walk now traverses it. The fixture is
  // created and torn down entirely inside this test -- it never lives in
  // the repo outside a single test run.
  const FIXTURE_ROOT = join(REPO_ROOT, "lib", "ai", "__tests__", "tmp-f030-fixture");
  const entryPath = join(FIXTURE_ROOT, "entry.ts");
  const hopAPath = join(FIXTURE_ROOT, "hop-a.ts");
  const hopBPath = join(FIXTURE_ROOT, "hop-b.ts");
  const leafPath = join(FIXTURE_ROOT, "leaf.ts");

  function plantFixture(): void {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    // Hop 1: entry -> hop-a, single-line (unremarkable).
    writeFileSync(entryPath, `import { a } from "./hop-a";\nexport { a };\n`, "utf8");
    // Hop 2 (the MIDDLE edge of the 3-hop chain): hop-a -> hop-b, written
    // as a multi-line named import -- the exact shape the old regex
    // could not see because it excluded "\n" from its character class.
    writeFileSync(
      hopAPath,
      ["import {", "  b,", "} from \"./hop-b\";", "", "export const a = b;", ""].join("\n"),
      "utf8",
    );
    // Hop 3: hop-b -> leaf, single-line.
    writeFileSync(hopBPath, `import { leak } from "./leaf";\nexport const b = leak;\n`, "utf8");
    // The forbidden reference the walk must reach.
    writeFileSync(leafPath, `export const leak = "service_role";\n`, "utf8");
  }

  function removeFixture(): void {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  }

  it("test_AS_001_guard_detects_a_3_hop_chain_whose_middle_edge_is_a_multi_line_import", () => {
    plantFixture();
    try {
      const result = walkForViolation(entryPath);
      expect(result.violation).not.toBeNull();
      expect(result.violation?.matched).toBe("service_role");
      // Full chain reported: entry -> hop-a -> hop-b -> leaf (3 hops).
      expect(result.chain).toEqual([entryPath, hopAPath, hopBPath, leafPath]);
    } finally {
      removeFixture();
    }
  });

  it("extractSpecifiers resolves a multi-line import specifier across newlines", () => {
    const multilineSource = ["import {", "  b,", "} from \"@/lib/x\";", ""].join("\n");
    expect(extractSpecifiers(multilineSource, "fixture.ts")).toEqual(["@/lib/x"]);
  });

  it("also covers import(), export * as ns from, and export ... from forms across newlines", () => {
    const source = [
      "await import(",
      "  '@/lib/dynamic'",
      ");",
      "export * as ns from",
      "  '@/lib/namespace';",
      "export {",
      "  thing,",
      "} from '@/lib/reexport';",
      "",
    ].join("\n");
    expect(extractSpecifiers(source, "fixture.ts")).toEqual([
      "@/lib/dynamic",
      "@/lib/namespace",
      "@/lib/reexport",
    ]);
  });

  it("test_AS_001_guard_now_opens_lib_supabase_preview_cookies_via_the_multiline_import_in_lib_supabase_server_ts", () => {
    // Regression for the specific live edge the old regex missed:
    // lib/supabase/server.ts imports lib/portal/preview-cookies.ts across
    // multiple lines. The walk must now be able to traverse that edge.
    const serverFile = join(REPO_ROOT, "lib", "supabase", "server.ts");
    const source = readFileSync(serverFile, "utf8");
    const specifiers = extractSpecifiers(source, serverFile);
    const resolved = specifiers
      .map((spec) => resolveSpecifier(serverFile, spec))
      .filter((p): p is string => p !== null);

    expect(resolved).toContain(join(REPO_ROOT, "lib", "portal", "preview-cookies.ts"));
  });
});
