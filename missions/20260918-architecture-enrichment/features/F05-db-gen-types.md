# F05 — `npm run db:gen-types` i commit

**Status:** [CLARIFIED]
**Estimate:** 15 min
**Depends on:** F01, F02, F03, F04

## Task

Nakon što su sve 4 migracije primenjene, regeneriši TypeScript tipove i commituj.

## Koraci

1. Primeni migracije:
   ```bash
   npm run db:apply -- supabase/migrations/20261127010000_architecture_discipline_estimates.sql
   npm run db:apply -- supabase/migrations/20261127020000_architecture_node_meta.sql
   ```
   Ako `db:apply` ne postoji, koristi `supabase db push` ili Supabase MCP `apply_migration`.

2. Regeneriši tipove:
   ```bash
   npm run db:gen-types
   ```

3. Verifikuj da `database.types.ts` (ili ekvivalent) sadrži `task_discipline_estimates` i `architecture_node_meta` tabele.

4. Commit samo `database.types.ts` i migracije.

## Definition of done

- [ ] Obe migracije su primenjene bez greške
- [ ] `database.types.ts` sadrži `task_discipline_estimates` i `architecture_node_meta`
- [ ] Git commit postoji sa tim fajlovima
