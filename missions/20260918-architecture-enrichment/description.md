# Architecture / Sitemap — obogaćivanje (estimates + copy brief)

Architecture tab per-projekat dobija:
1. Procene napora po disciplini (design, dev, content_seo, pm, qa) na sekcijama i stranicama, sa automatskim rollup-om sekcija → stranica → sajt i poređenjem sa stvarno utrošenim vremenom.
2. Copy brief polja po čvoru (intent, audience, CTA, tone, keywords, copy_status) za pripremu AI generisanja kopija u kasnijoj fazi, sa export-om u Markdown/JSON.
3. "Details" toggle (octopus.do stil), **default isključen** — board izgleda identično danas dok se toggle svesno ne uključi; procene i copy meta se učitavaju lenjo samo kada je toggle uključen.

Stranica = task (page_slug set, parent_task_id null). Sekcija = subtask (parent_task_id = page task id). Nema sitemap tabele.
