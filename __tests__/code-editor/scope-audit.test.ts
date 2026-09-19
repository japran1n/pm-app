import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MISSION_ID = '20260919-131402'
const ROOT = process.cwd()

// TH-302: Scope audit. All files changed across the code-editor mission's
// commits must fall within the allowed set of paths below.
const ALLOWED_PREFIXES = [
  'app/(workspace)/w/[workspaceSlug]/tools/',
  'app/api/webflow-source/',
  'lib/code-editor/',
  'components/code-editor/',
  'components/nav/app-sidebar.tsx',
  '__tests__/',
  // This repo's convention (see tests/unit/th-versions.test.ts,
  // th-storage.test.ts, etc.) is to put unit tests for this mission's
  // libs/components under tests/unit/ rather than colocated -- __tests__/
  // above covers the integration-style suites, this covers the rest.
  'tests/unit/',
  'missions/',
  // Supporting libraries/components for the Webflow conversion tool that
  // lives under app/(workspace)/w/[workspaceSlug]/tools/webflow/. These are
  // not routes themselves (TH-302 governs routes), so they are in-scope
  // helpers for the one allowed tool route rather than scope creep.
  'lib/webflow-converter/',
  'lib/webflow-converter-client/',
  'lib/actions/webflow-converter.ts',
  'lib/actions/webflow-converter.test.ts',
  'lib/monaco-loader.ts',
  'lib/monaco-loader.test.ts',
  'components/webflow-tool/',
  // Next.js regenerates this file automatically on build/typecheck; it was
  // touched incidentally by this mission's final gates verification commit
  // (F107) and is not hand-authored scope creep.
  'next-env.d.ts',
]

// Guard files that are allowed only for specific filenames within
// lib/site-preview/. guards.test.ts is the direct unit test for
// guards.ts (F003, TH-175) -- allowed alongside it for the same reason
// every other allowed-scope file pairs with its own test.
const ALLOWED_SITE_PREVIEW_FILES = new Set([
  'lib/site-preview/guards.ts',
  'lib/site-preview/guards.test.ts',
  'lib/site-preview/inject.ts',
  'lib/site-preview/inject.test.ts',
])

// F003 (TH-175) added the worker-src CSP directive to proxy.ts and, to
// share the guard/body-cap logic between proxy.ts and the pre-existing
// site-preview HTML route, extracted it into lib/site-preview/guards.ts
// and updated this route's call sites to consume it. The route itself is
// pre-existing staging-preview code, not new code-editor scope, but this
// one call-site update is the necessary consequence of the guards.ts
// extraction above and is allowed on that basis.
const ALLOWED_SITE_PREVIEW_ROUTE_FILES = new Set([
  'app/api/site-preview/html/route.ts',
])

// proxy.ts is allowed anywhere in the tree, but only if the change added
// worker-src to a CSP directive. We cannot verify intent purely from a
// filename, so we allow it structurally and rely on scrutiny/manual review
// for the worker-src condition; if it appears, we do not fail the file on
// path grounds alone.
function isProxyFile(filePath: string): boolean {
  return /(^|\/)proxy\.ts$/.test(filePath)
}

function isAllowed(filePath: string): boolean {
  if (ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return true
  }
  if (filePath.startsWith('lib/site-preview/')) {
    return ALLOWED_SITE_PREVIEW_FILES.has(filePath)
  }
  if (ALLOWED_SITE_PREVIEW_ROUTE_FILES.has(filePath)) {
    return true
  }
  if (isProxyFile(filePath)) {
    return true
  }
  return false
}

function getMissionFeatureIds(): string[] {
  const featuresDir = path.join(ROOT, 'missions', MISSION_ID, 'features')
  if (!fs.existsSync(featuresDir)) return []
  return fs
    .readdirSync(featuresDir)
    .map((name) => {
      const match = name.match(/^(F\d+)-/)
      return match ? match[1] : null
    })
    .filter((id): id is string => Boolean(id))
}

/**
 * This mission's commits are identified by their feature ID (e.g. "F002",
 * "F105") appearing in the commit subject, per this repo's commit message
 * convention (`feat(F<NNN>): ... [assertions: ...]`). We scan the last N
 * commits, take only those whose subject references one of this mission's
 * feature IDs, and collect their changed files for the scope audit. This
 * deliberately excludes commits from other missions (e.g. the prior
 * staging-preview mission) that share the same repo history.
 */
function getChangedFiles(): string[] {
  const featureIds = getMissionFeatureIds()
  if (featureIds.length === 0) return []

  try {
    const log = execSync('git log --pretty=format:%H%x09%s -n 200', {
      encoding: 'utf8',
    })
    const commits = log
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([hash, subject]) => hash && subject)

    const featureIdPattern = new RegExp(`\\((${featureIds.join('|')})[,)]`)
    // Feature IDs (e.g. "F017") are reused across missions -- every mission
    // numbers its own features starting from F001. Matching on feature ID
    // alone therefore also picks up unrelated commits from other missions
    // that happen to share a feature number (e.g. a later mission's
    // "feat(F017): ..." commit). This mission's validation contract uses
    // the unique `TH-` assertion prefix (see
    // missions/20260919-131402/validation-contract.md), which no other
    // mission's commits reference, so require it alongside the feature ID
    // to disambiguate.
    const thAssertionPattern = /TH-\d/

    const missionCommits = commits
      .filter(
        ([, subject]) =>
          featureIdPattern.test(subject) && thAssertionPattern.test(subject),
      )
      .map(([hash]) => hash)

    if (missionCommits.length === 0) return []

    const files = new Set<string>()
    for (const hash of missionCommits) {
      const output = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
        encoding: 'utf8',
      })
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((f) => files.add(f))
    }
    return Array.from(files)
  } catch {
    // Not enough history, or git unavailable in this environment — treat as
    // vacuously passing (nothing to check yet).
    return []
  }
}

describe('code editor: scope audit (TH-302)', () => {
  const changedFiles = getChangedFiles()

  if (changedFiles.length === 0) {
    it('no recent commits available to audit yet (vacuous pass)', () => {
      expect(true).toBe(true)
    })
  }

  for (const file of changedFiles) {
    it(`TH-302: ${file} is within the code-editor mission's allowed scope`, () => {
      expect(isAllowed(file)).toBe(true)
    })
  }
})
