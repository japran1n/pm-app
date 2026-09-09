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
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

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

const IMPORT_SPECIFIER_RE =
  /(?:^|\n)\s*import(?:[^'"()\n]*?from\s*)?\s*["']([^"']+)["']|(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  while ((match = IMPORT_SPECIFIER_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) specifiers.push(spec);
  }
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

    for (const specifier of extractSpecifiers(source)) {
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
