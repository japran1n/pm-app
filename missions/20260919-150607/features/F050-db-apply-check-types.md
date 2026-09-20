# F050 — db:apply, migrations:check, db:gen-types

_Mission: 20260919-150607_ _Milestone: M9_ _Depends on: F049_

## Svrha

Verificirati da su sve migracije aplicirane na remote bazu, da nema drifta između sheme i migracija, i da su TypeScript tipovi sinhronizovani.

## Tvrdnje

- **AS-170**: `npx supabase migration list` shows all local migrations have matching remote entry (local = remote)
- **AS-171**: `npx supabase db diff --use-migra` exits 0 with empty output (no schema drift)
- **AS-172**: The TypeScript types file at `lib/database.types.ts` (or wherever types are generated) does NOT reference `page_components.description` (dropped in F032)
- **AS-173**: The TypeScript types file does NOT reference `node_meta.client_visible` (dropped in F033)
- **AS-174**: Running `npx supabase gen types typescript --local` (or `--project-id`) produces output consistent with the current types file — no new columns that aren't in the types

## Clarified implementation

1. Run `npx supabase migration list` via Bash — verify all show local=remote (no unapplied migrations). Record output in handoff.

2. Run `npx supabase db diff --use-migra` — verify output is empty or contains only harmless differences. Record in handoff.

3. Read `lib/database.types.ts` (find the actual types file path first). Grep for `description` in the `page_components` type — must not exist. Grep for `client_visible` in `node_meta` type — must not exist.

4. Write assertions in `tests/unit/m9-migration-check.test.ts`:
   - Read `lib/database.types.ts` and assert it does NOT contain `page_components.description`
   - Assert it does NOT contain `node_meta.client_visible`
   
5. If the types file is stale (still references dropped columns), regenerate: find the gen-types command from package.json scripts and run it. Then commit the updated types file.

6. Commit and write handoff.

## Definition of done

- All migrations applied (no unapplied local migrations)
- Types file doesn't reference dropped columns
- Test passes asserting the absence
- tsc + lint clean
