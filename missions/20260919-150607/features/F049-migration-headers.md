# F049 — Header komentari i redoslijed aditivno→destruktivno

_Mission: 20260919-150607_ _Milestone: M9_

## Svrha

Svaka migracija dodata u ovoj misiji treba header komentar koji objašnjava zašto postoji i redoslijed: aditivne izmjene (dodavanje kolona/tabela) idu prije destruktivnih (brisanje kolona/tabela/politika).

## Šta se gradi

Audit i eventualna korekcija header komentara na migracijama ovog misiona:
- `20261127130000_drop_page_components_description.sql` (F032)
- `20261127140000_drop_node_meta_client_visible.sql` (F033)

And verify ordering: additive migrations before destructive migrations.

## Tvrdnje

- **AS-168**: Every migration file added by this mission has a leading `-- ` comment block explaining why it exists and what it changes
- **AS-169**: Additive migrations (ADD COLUMN, CREATE TABLE) precede destructive ones (DROP COLUMN, DROP TABLE, DROP POLICY) in filename timestamp order

## Clarified implementation

- Read the two mission migration files
- If comments are absent or inadequate, add them (one-liner minimum: `-- F0XX: reason for this change`)
- Verify timestamp ordering: additive before destructive
- Write a unit test in `tests/unit/m9-migration-headers.test.ts` that reads every migration file matching the M5 timestamps and asserts: (a) each starts with a `--` comment, (b) the additive migration has an earlier timestamp than the destructive one(s)
- Commit

## Definition of done

- Both migration files have header comments
- Test in `m9-migration-headers.test.ts` passes: asserts comments exist and ordering is correct
- tsc + lint clean
