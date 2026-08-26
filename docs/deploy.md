# Deploy: kako izmena stigne na produkciju

## Šta je već tu

- **Produkcija:** https://pm-app-beige.vercel.app (živa, vraća 200).
- **Supabase Auth je već podešen za nju:** `site_url` je prod domen, a
  `uri_allow_list` sadrži i prod i `http://localhost:3000` — magic-link
  callback radi na oba, ništa se tu ne dira.
- **Email radi u produkciji:** SMTP je `smtp.resend.com`. (README pod
  "Email / Resend (not connected)" je zastareo — Resend jeste povezan kao
  SMTP provajder u Supabase-u, samo ga aplikativni kod ne koristi direktno.)
- **Password login ne traži nikakvu novu env varijablu.** Email provider je
  uključen, `password_min_length = 6`.

## Korak po korak

1. **Merge grane u `main` i push.**
   ```
   git switch main && git merge feat/password-auth && git push origin main
   ```
   Vercel projekat je gotovo sigurno git-connected (auto-generisan
   `*-beige.vercel.app` domen je potpis GitHub importa), pa push na `main`
   sam pokreće deploy. Ako se posle 2–3 minuta na prod `/sign-in` i dalje
   ne vide tabovi, projekat nije git-connected i deploy ide ručno preko
   `npx vercel --prod` (traži `vercel login` u browseru).

2. **Provera da build ne pukne.** `npm run build` lokalno prolazi (provereno).
   Napomena: `.github/workflows/ci.yml` radi type-check, lint i testove ali
   **ne radi `npm run build`** — dakle CI ne bi uhvatio grešku koja se javlja
   samo u produkcijskom build-u. Vredi dodati taj korak.

3. **Verifikacija na produkciji.** `/sign-in` mora da prikaže dva taba
   (Password / Magic link) i login emailom + lozinkom mora da prođe.

4. **`ALLOW_USERNAME_LOGIN` ostaviti nepodešen u Vercelu.** Podrazumevano je
   isključen van developmenta, pa u produkciji radi samo email + lozinka.
   Login samim username-om je testerska pogodnost i traži admin ključ za
   pretragu naloga — nema razloga da to stoji otvoreno u produkciji.

5. **`/dev-login` je već bezbedan** — vraća 404 kad `NODE_ENV !== "development"`.

## Ono što traži odluku pre merge-a

### Dev i produkcija dele istu Supabase bazu

`.env` pokazuje na isti projekat (`qcipqonnqajmazdbysow`) na koji pokazuje i
prod `site_url`. Posledice:

- **Demo nalozi koje sam napravio već postoje u produkcijskoj bazi.**
  Dok je login bio samo magic-link, `sasa@demo.test` nije mogao da se uloguje
  (nema tu poštu). Čim se ovaj feature deploy-uje, `sasa@demo.test` /
  `Demo1234!` postaje **važeći login na produkciji**, i to sa `owner`
  ulogom. Isto važi za ostalih pet naloga.
- U bazi je i ~30.000 profila i 143 workspace-a zaostalih iz test runova.
- `npm run seed:demo` briše i ponovo pravi `acme-studio` — pokrenut greškom
  sa prod `.env`-om, briše prave podatke.

Tri načina da se to reši, od najbržeg do najtrajnijeg:

1. **Obrisati demo naloge pre merge-a** i seed pokretati samo kad zatreba.
   Najbrže, ali gubiš demo podatke koje si upravo dobio.
2. **Dodati `ALLOW_PASSWORD_LOGIN` gate** — password login radi svuda osim na
   prod domenu. Demo nalozi ostaju, prod je zatvoren. Sat vremena posla.
3. **Odvojiti dev bazu** — nov Supabase projekat, `supabase db push` primeni
   sve migracije, `.env` pokazuje na njega. Pravo rešenje: od tog trenutka
   ništa što radim lokalno ne dodiruje produkciju, ni podaci ni šema.
   Ovo je i preduslov da bezbedno razvijam klijentski portal, jer taj feature
   nosi migracije.

### Otvorena registracija

`disable_signup = false` — svako ko zna prod URL može da zatraži magic link,
napravi nalog i otvori svoj workspace. Nezavisno od ove izmene, ali vredi
odlučiti pre nego što aplikacija dobije prave korisnike.
