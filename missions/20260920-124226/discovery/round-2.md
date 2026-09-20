# Discovery Round 2

_Captured: 2026-09-20T11:09:08Z_

Follow-ups generated from round-1 gaps: the Q3 conflict with the existing RLS
policy, the Q6 scope change (tasks out of the Planner), the Q15b+Q16b
interaction, the Q24 colour conflict, and the three unanswered questions
(Q7, Q18, Q20).

## Sudar sa postojećim RLS-om

**2.1. `calendar_blocks_select_visible` danas krije blok vezan za projekat koji
ne vidiš. Šta radimo?**
- (a) Ostavi RLS kakav jeste — privatni projekti ostaju privatni
- (b) Promeni RLS: svaki član workspace-a vidi svaki blok, pun naslov   <- chosen
- (c) Promeni RLS: blok se vidi ali naslov zamenjen sa "Zauzeto"
- (d) Ne znam — odluči ti

> **CONSEQUENCE (must appear in the plan and tech-decisions):** this
> contradicts description.md's "Nema izmene baze". Choosing (b) requires a
> new migration replacing calendar_blocks_select_visible with a
> workspace-member-only predicate, dropping the is_project_visible_to
> branch. De-risked by 2.2 below.

**2.2. Da li uopšte postoje privatni projekti u praksi kod vas?**
- (a) Postoje i bitni su
- (b) Postoje ali se ne koriste
- (c) Ne postoje                                  <- chosen
- (d) Ne znam

> Makes 2.1(b) low-risk in practice: the branch being dropped matches no
> real rows today. The policy change is still a real permission widening and
> must be called out as such.

## Izbacivanje taskova iz Planner-a

**2.3. Šta tačno "izbaciti taskove" znači?**
- (a) Ukloni all-day trake; Planner prikazuje samo blokove i PTO   <- chosen
- (b) Ukloni trake, zadrži taskove kao izvor za kreiranje bloka
- (c) Sakrij iza toggle-a, kod ostaje
- (d) Ukloni sve, uključujući vezu bloka na task

**2.4. Filters bar (Status / Prioritet / Izvršilac / Projekat)?**
- (a) Briše se ceo, ostaje samo switcher ljudi     <- chosen
- (b) Ostaje samo filter po projektu
- (c) Ostaje ceo, primenjen na blokove
- (d) Ne znam

**2.5. Da li blok i dalje sme da bude vezan za task (`task_id`)?**
- (a) Da, veza ostaje i vidi se na bloku
- (b) Da, ali bez prikaza u mreži
- (c) Ne, veza se uklanja                          <- chosen
- (d) Ne znam

> **CONSEQUENCE:** second departure from "nema izmene baze". Removing the
> task link means dropping calendar_blocks.task_id (and its partial index
> calendar_blocks_task_id_idx), plus the task-picker field in
> calendar-block-popover-form.tsx and the task_id path in
> lib/actions/calendar-blocks.ts + lib/validation/calendar-blocks.ts.
> The plan must decide drop-column vs leave-unused; the user's answer is
> "veza se uklanja", so drop is the faithful reading.

**2.6. Gde korisnik vidi rokove kad ih Planner više ne pokazuje?**
- (a) Na postojećoj My Tasks strani, dovoljno je   <- chosen
- (b) Mala lista "rokovi ove nedelje" sa strane
- (c) Nigde, nije problem
- (d) Kasnije, van obima

## Stacked mod

**2.7. Puna satna mreža po osobi — koliko visoka?**
- (a) Skraćena na radne sate da stane
- (b) Puna 24h po osobi, skroluje se
- (c) Kompaktne trake po danu
- (d) Svaka osoba sklopiva
- <- custom: "radno vreme je od 08:00 - 16:00, i to je ono sto je bitno na
  stacked, i za sada monday to friday, 5 dana"

> Closest to (a), with two hard numbers the plan must honour:
> stacked rows render **08:00-16:00 only** and **Mon-Fri only (5 columns)**,
> not the 7-day / 24h window the existing week grid uses. "za sada" =
> hardcoded constants now, not a settings surface.
> OPEN for the plan: what happens to a block that falls partly or wholly
> outside 08:00-16:00, or on Sat/Sun, in stacked view. Not asked; the plan
> must state an explicit answer rather than let it be incidental.

**2.8. Čemu `?view=` ako izbor više ljudi sam prebacuje u stacked?**
- (a) Mod se izvodi iz broja ljudi; `?view=` se izbacuje   <- chosen
- (b) `?view=` ostaje za ručno forsiranje
- (c) Ostaje za buduće modove
- (d) Ne znam

> **SCOPE CHANGE vs description.md:** the `?view=stacked` param named in the
> mission description is dropped. URL state is `?people=` + `?week=` only.

**2.9. Redosled ljudi u stacked modu?**
- (a) Ja prvi, ostali abecedno                     <- chosen
- (b) Svi abecedno
- (c) Po zauzetosti
- (d) Ručno prevlačenje
- <- custom addition: "ali moze i rucno da se prevlaci"

> Default ordering (a) PLUS manual drag-reorder on top. OPEN for the plan:
> whether a manual order persists (URL / localStorage / DB) or resets on
> reload. Q30 answered "sve stanje u URL-u, nista u localStorage", which
> points at encoding the order in `?people=` itself.

## Boje

**2.10. Boja bloka vs boja osobe?**
- (a) Boja bloka glavna; osoba = avatar + tanka traka na ivici   <- chosen
- (b) Boja po osobi pobeđuje
- (c) Samo boja bloka, bez oznake osobe
- (d) Ne znam

**2.11. Treba li boja osobe u stacked modu, gde svako ima svoj red?**
- (a) Ne treba — ime reda je dovoljno              <- chosen
- (b) Treba, radi konzistentnosti
- (c) Samo tanka traka uz ivicu reda
- (d) Ne znam

## PTO

**2.12. PTO u stacked redu?**
- (a) Ista traka kao sad, iznad mreže tog reda     <- chosen
- (b) Cela kolona zatamnjena
- (c) Badge pored imena
- (d) Ne prikazuje se

**2.13. Dugme "Dodaj odsustvo"?**
- (a) Ostaje kako jeste, uvek upisuje za mene      <- chosen
- (b) U tuđem planneru ga nema
- (c) Admin može drugome
- (d) Ne znam

## Granice

**2.14. Sati / pun dan / pauza van obima?**
- (a) Da, van obima                                <- chosen
- (b) Samo prikaz sati po danu
- (c) Punoća 7h
- (d) Ne znam

**2.15. Dokle sme refaktorisanje?**
- (a) week-time-grid.tsx sme da se razloži, ponašanje mojih blokova identično  <- chosen
- (b) Sme i promena kreiranja/pomeranja
- (c) Minimalno diranje
- (d) Ne znam

---

## Orchestrator summary of scope deltas vs description.md

The captured description said "Nema izmene baze" and named `?view=stacked`.
Round-2 answers override all three of those points. The plan must carry:

1. **DB change required** (2.1b): new migration widening
   calendar_blocks_select_visible to workspace-member-only.
2. **DB change required** (2.5c): drop calendar_blocks.task_id + its index.
3. **`?view=` dropped** (2.8a): mode derives from the `?people=` count.
4. **Tasks leave the Planner entirely** (2.3a, 2.4a): getCalendarTasks,
   CalendarFilters, resolveCalendarFilters and the all-day strip path all
   become dead code on this route. Affected tests:
   tests/integration/f233-calendar-task-interactions.test.ts,
   tests/integration/f235-calendar-filters.test.ts,
   tests/integration/f232-calendar-query.test.ts,
   tests/e2e/f235-calendar-responsive.spec.ts.
5. **Stacked geometry is 08:00-16:00, Mon-Fri** (2.7), unlike the week
   grid's 24h/7-day window.

Two questions the answers imply but nobody asked, which the plan must answer
explicitly rather than leave to a worker's discretion:

- What stacked does with a block outside 08:00-16:00 or on Sat/Sun.
- Whether the manual person-order from 2.9 persists, and where.

---

## Addendum — the two open questions, answered

_Captured: 2026-09-20T11:13:47Z_

**A1. Block outside 08:00-16:00, or on Sat/Sun.**
User: "stacked vidi samo 08-16, a ako gledam me mode ili samo neciji tudji
(1 osobu), onda vidim full, sve sate + vikend."

Resolved, and it settles the geometry rule for the whole feature:

| Selection | View | Window |
|---|---|---|
| 1 person (me, or one colleague) | existing week grid | 24h x 7 days (unchanged) |
| 2+ people | stacked | 08:00-16:00 x Mon-Fri |

So stacked genuinely CLIPS: a block at 06:00, at 18:00, or on Saturday is
not shown in stacked at all. It is not an error state and not an overflow
indicator by default -- the user gets the full picture by selecting that one
person, which drops back to the 24h/7-day grid. The plan must still decide
whether a clipped block leaves any trace (e.g. a subtle "+2 outside hours"
marker) and state that decision explicitly; nothing in the answers requires
one, so the default reading is: no trace, clean 08-16 Mon-Fri.

**A2. Persistence of the manual person order (2.9).**
User: "kako god." -- delegated to the orchestrator.

ORCHESTRATOR_DECISION: the order is carried by the `?people=` parameter
itself -- the id sequence IS the row order. No localStorage, no DB column,
no new table. Rationale: Q30 answered "sve stanje u URL-u, nista u
localStorage", and a dragged order that survives a reload but cannot be
shared in a link would contradict that. Consequence the plan must honour:
`?people=` is order-significant, so the parser must NOT sort or dedupe into
a Set and then re-emit; it preserves the given sequence, dropping only
invalid ids (per Q9). The "Ceo tim" shortcut writes the 2.9(a) default
order: me first, then the rest alphabetically.
