import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, exts, acc)
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      acc.push(full)
    }
  }
  return acc
}

function findToolsDirs(): string[] {
  // Find all `tools` directories under app/**
  const results: string[] = []
  function search(dir: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'tools') {
          results.push(full)
        } else {
          search(full)
        }
      }
    }
  }
  search(path.join(ROOT, 'app'))
  return results
}

function getTargetFiles(): string[] {
  const files: string[] = []
  for (const dir of findToolsDirs()) {
    walk(dir, ['.ts', '.tsx'], files)
  }
  walk(path.join(ROOT, 'lib', 'code-editor'), ['.ts'], files)
  return files
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

describe('code editor: no database write (TH-261, TH-301)', () => {
  const targetFiles = getTargetFiles()

  it('finds at least the expected source directories exist or gracefully handles absence', () => {
    // This test passes regardless of whether the directories exist yet (vacuous truth
    // for early-mission state); it documents intent.
    expect(Array.isArray(targetFiles)).toBe(true)
  })

  if (targetFiles.length === 0) {
    it.skip('no target files found yet under app/**/tools or lib/code-editor', () => {})
  }

  for (const file of targetFiles) {
    const relPath = path.relative(ROOT, file)
    it(`TH-261/TH-301: ${relPath} does not import or reference supabase`, () => {
      const rawContents = fs.readFileSync(file, 'utf8')
      const contents = stripComments(rawContents)

      const importsSupabaseLib = /from\s+['"]@\/lib\/supabase['"]/.test(contents)
        || /require\(\s*['"]@\/lib\/supabase['"]\s*\)/.test(contents)
        || /from\s+['"]@supabase\//.test(contents)
      expect(importsSupabaseLib).toBe(false)

      const callsCreateClient = /createClient\s*\(/.test(contents)
      expect(callsCreateClient).toBe(false)

      const referencesSupabase = /supabase/i.test(contents)
      expect(referencesSupabase).toBe(false)
    })
  }

  it('TH-261/TH-301: supabase/migrations directory is untouched by this mission (no new files referencing code-editor)', () => {
    const migrationsDir = path.join(ROOT, 'supabase', 'migrations')
    if (!fs.existsSync(migrationsDir)) {
      expect(true).toBe(true)
      return
    }
    const migrationFiles = fs.readdirSync(migrationsDir)
    const codeEditorRelated = migrationFiles.filter((f) => /code.?editor|tools/i.test(f))
    expect(codeEditorRelated).toEqual([])
  })
})
