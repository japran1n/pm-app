# Description

_Captured: 2026-09-20T10:42:26Z_

Team Planner — u Planneru (/w/[slug]/calendar) po defaultu se vidi moj planner (samo moji calendar_blocks), uz switcher u headeru kojim mogu da izaberem bilo kog člana tima ili više njih odjednom, plus "stacked" mod (?view=stacked) gde se svi izabrani ljudi ređaju jedan ispod drugog u swimlane redove sa pregledom zauzetosti (sati po danu, PTO, broj taskova sa rokom). Sve na istoj ruti preko URL parametara ?people= i ?view=. Niko ne sme da menja tuđe blokove — tuđi blokovi su read-only u UI-ju (RLS to već sprovodi na serveru, UI trenutno pogrešno nudi drag/resize). Nema izmene baze: calendar_blocks.user_id i postojeće RLS politike su dovoljne. Trenutno stanje bug-a koji ovo usput popravlja: getCalendarBlocks ne filtrira po user_id pa Planner već sada prikazuje blokove cele ekipe pomešane bez oznake čiji su.
