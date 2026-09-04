// F107 follow-up (missions/20260903-portal): the Overview page shipped
// broken in production because a server component (`app/(portal)/portal/
// [workspaceSlug]/p/[projectId]/page.tsx`, no "use client" directive)
// imported and CALLED `computeBurndownSeries`, a plain function exported
// from `components/portal/hours-burndown-chart.tsx`, which has a
// `"use client"` directive at its top. Once a module is marked
// `"use client"`, every one of its exports becomes a client-reference
// proxy for any server-side importer -- calling one (not just importing
// its type) throws at request time: "Attempted to call X() from the
// server but X is on the client." `npx tsc --noEmit` and `npm run build`
// both stayed green through that defect (this is a Next.js RSC runtime
// rule, not a TypeScript or bundler-time one) -- the same class of
// defect this mission's own F069 handoff independently hit and fixed by
// extracting the pure function to a directive-free module
// (lib/metrics/measurement-status.ts).
//
// This is a static, source-level check (no server needs to boot) for the
// exact shape of that defect: no file WITHOUT a "use client" directive
// may import a named (non type-only) binding from a file that HAS one and
// then use it as a runtime value in a non-JSX position -- a function call
// (`Name(...)`) or a property/member access (`Name.foo`), per the
// coordinator's own follow-up request after this test caught the
// original regression. Rendering the SAME import as JSX (`<Name />`, or
// a compound `<Name.Sub />`) is excluded deliberately: that is the
// entire point of composing Server and Client Components and is not
// this defect. It walks `app/`, `components/`, and `lib/` rather than
// every file in the repo, to keep it fast and its intent obvious.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];
const EXTENSIONS = [".ts", ".tsx"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", ".git"]);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(full));
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext)) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function isUseClientFile(source: string): boolean {
  // The directive must be the first statement (ignoring comments/blank
  // lines) -- a mention of the string inside a comment elsewhere in the
  // file (this repo has several, describing a CHILD component) does not
  // count. Same distinction F069's own handoff had to make by hand.
  const firstStatementMatch = source.match(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\n?|\s*\n)*(["'])use client\1/);
  return firstStatementMatch !== null;
}

// Resolves a relative "@/..." or "./..." import specifier to a real file
// path, trying the extensions/`index` conventions this repo uses. Returns
// null for a package import (no leading "@/" or ".") -- those are never
// a same-repo "use client" boundary crossing.
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = join(fromFile, "..", specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Named, VALUE imports only -- `import type { X }` and the type-only
// form inside a mixed import (`import { type X, y }`) are erased at
// compile time and never become a client-reference proxy call, so they
// are excluded deliberately (matching lib/metrics/measurement-status.ts's
// own comment on exactly this distinction).
function extractValueImportSpecifiers(source: string): { specifier: string; names: string[] }[] {
  const results: { specifier: string; names: string[] }[] = [];
  const importRegex = /import\s+(type\s+)?(?:([\w$]+)\s*,?\s*)?(\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const [, isTypeOnlyImport, , namedBlock, specifier] = match;
    if (isTypeOnlyImport) continue;
    if (!namedBlock) continue; // default-only import, not this defect's shape
    const names = namedBlock
      .replace(/[{}]/g, "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((n) => !n.startsWith("type ")); // per-specifier `type X`
    if (names.length > 0) {
      results.push({ specifier, names });
    }
  }
  return results;
}

describe("server files never call a value exported from a \"use client\" module", () => {
  const files = SCAN_DIRS.flatMap((dir) => listFiles(join(ROOT, dir)));
  const sourceByFile = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  const violations: string[] = [];

  // Rendering a "use client" component as JSX from a Server Component is
  // the whole point of the App Router and is NOT this defect -- only
  // USING an imported name as a runtime value in a non-JSX position
  // (calling it, or reading a property off it) is. `usedAsJsx` vs.
  // `usedAsRuntimeValue` is a heuristic, not a full parse, but it is the
  // exact distinction that separates every legitimate
  // `<PhaseList />`/`<Toaster />`/`<Dialog.Trigger />` import in this
  // codebase from the one real defect this test exists to catch
  // (`computeBurndownSeries(...)`, never rendered as JSX).
  //
  // F107 round 2 (coordinator review): "extending it to catch a server
  // component rendering a client-only value in a non-JSX position" --
  // the original round only checked a bare function call
  // (`Name(`). A `"use client"` export read via property/member access
  // (`Name.something`, e.g. a client-only constant object or a static
  // method) is the same class of runtime access and throws for the
  // identical reason, so it is now covered too. A compound JSX tag
  // (`<Dialog.Trigger />`) is excluded from BOTH the JSX check and the
  // property-access check by checking for `<Name` OR `<Name\.` as JSX
  // usage, so a legitimate compound-component render is never flagged
  // for the member access its own JSX already performs.
  function usedAsJsx(source: string, name: string): boolean {
    return new RegExp(`<${name}\\b`).test(source);
  }
  function usedAsCall(source: string, name: string): boolean {
    return new RegExp(`\\b${name}\\s*\\(`).test(source);
  }
  function usedAsPropertyAccess(source: string, name: string): boolean {
    return new RegExp(`\\b${name}\\.[A-Za-z_$]`).test(source);
  }

  for (const file of files) {
    const source = sourceByFile.get(file)!;
    if (isUseClientFile(source)) continue; // this file's own callers are client components

    for (const { specifier, names } of extractValueImportSpecifiers(source)) {
      const resolved = resolveImport(file, specifier);
      if (!resolved) continue;
      const targetSource = sourceByFile.get(resolved);
      if (targetSource === undefined) continue;
      if (!isUseClientFile(targetSource)) continue;

      const usedAsRuntimeValueNotRendered = names.filter(
        (name) =>
          (usedAsCall(source, name) || usedAsPropertyAccess(source, name)) &&
          !usedAsJsx(source, name),
      );
      if (usedAsRuntimeValueNotRendered.length > 0) {
        violations.push(
          `${relative(ROOT, file)} uses [${usedAsRuntimeValueNotRendered.join(", ")}] as a ` +
            `runtime value (call or property access), imported from ${relative(ROOT, resolved)}, ` +
            `which has a "use client" directive`,
        );
      }
    }
  }

  it("test_no_server_file_imports_a_runtime_value_from_a_use_client_module", () => {
    expect(violations).toEqual([]);
  });
});
